import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const source = await readFile(new URL("./git-manager.ts", import.meta.url), "utf8");
const execFileAsync = promisify(execFile);

async function git(cwd, ...args) {
  return execFileAsync("git", ["-C", cwd, ...args]);
}

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./git-manager.ts");
}

test("force-deletes an explicitly confirmed local branch", () => {
  assert.match(source, /action === "delete_branch"[\s\S]*?\["branch", "-D", "--", await assertBranchName/);
});

test("prunes the tracking reference after deleting a remote branch", () => {
  assert.match(source, /action === "delete_remote_branch"[\s\S]*?\["push", remote\.remote, "--delete", remote\.branch\][\s\S]*?\["fetch", "--prune", remote\.remote\]/);
});

test("merges a local source branch into an explicit local target branch", () => {
  assert.match(source, /action === "merge_branch"[\s\S]*?Source branch[\s\S]*?Target branch[\s\S]*?worktreeForBranch[\s\S]*?\["merge", "--no-edit", source\]/);
});

test("restores the whole working tree to its pre-edit state", async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-desktop-git-discard-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await git(cwd, "init", "--initial-branch=main");
  await git(cwd, "config", "user.email", "test@example.com");
  await git(cwd, "config", "user.name", "Test User");
  await writeFile(path.join(cwd, "test.txt"), "original\n");
  await git(cwd, "add", "test.txt");
  await git(cwd, "commit", "-m", "initial");
  await writeFile(path.join(cwd, "test.txt"), "modified\n");
  await git(cwd, "add", "test.txt");

  const { runGitAction } = await loadSubject();
  const summary = await runGitAction(cwd, "discard_all");

  await git(cwd, "cat-file", "blob", "main:test.txt");
  assert.equal((await git(cwd, "show", "main:test.txt")).stdout.trim(), "original");
  assert.deepEqual(summary.changes.files.length, 0);
});

test("discards staged, unstaged, and untracked changes in one action", async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-desktop-git-discard-all-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await git(cwd, "init", "--initial-branch=main");
  await git(cwd, "config", "user.email", "test@example.com");
  await git(cwd, "config", "user.name", "Test User");
  await writeFile(path.join(cwd, "tracked.txt"), "original\n");
  await git(cwd, "add", "tracked.txt");
  await git(cwd, "commit", "-m", "initial");

  await writeFile(path.join(cwd, "tracked.txt"), "modified\n");
  await writeFile(path.join(cwd, "staged.txt"), "staged\n");
  await git(cwd, "add", "staged.txt");
  await writeFile(path.join(cwd, "untracked.txt"), "untracked\n");
  await mkdir(path.join(cwd, "nested"), { recursive: true });
  await writeFile(path.join(cwd, "nested", "deep.txt"), "deep\n");
  await writeFile(path.join(cwd, ".gitignore"), "ignored.txt\n");
  await writeFile(path.join(cwd, "ignored.txt"), "ignored\n");

  const { runGitAction, getGitSummary } = await loadSubject();
  const before = await getGitSummary(cwd);
  assert.deepEqual(before.untrackedPaths.map((filePath) => path.basename(filePath)).sort(), [".gitignore", "nested", "untracked.txt"]);

  const summary = await runGitAction(cwd, "discard_all");

  assert.equal((await git(cwd, "show", "main:tracked.txt")).stdout.trim(), "original");
  assert.deepEqual(summary.changes.files.length, 0, "no change may survive discard_all");
  assert.deepEqual((await readdir(cwd)).sort(), [".git", "ignored.txt", "tracked.txt"]);
  assert.equal(await readFile(path.join(cwd, "ignored.txt"), "utf8"), "ignored\n");
});

test("merges source commits into the requested target branch", async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-desktop-git-merge-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await git(cwd, "init", "--initial-branch=main");
  await git(cwd, "config", "user.email", "test@example.com");
  await git(cwd, "config", "user.name", "Test User");
  await writeFile(path.join(cwd, "base.txt"), "base\n");
  await git(cwd, "add", "base.txt");
  await git(cwd, "commit", "-m", "base");
  await git(cwd, "checkout", "-b", "source");
  await writeFile(path.join(cwd, "source.txt"), "source\n");
  await git(cwd, "add", "source.txt");
  await git(cwd, "commit", "-m", "source");
  await git(cwd, "checkout", "main");

  const { runGitAction } = await loadSubject();
  const summary = await runGitAction(cwd, "merge_branch", { branch: "source", targetBranch: "main" });

  await git(cwd, "rev-parse", "--verify", "main^{tree}:source.txt");
  assert.equal((await git(cwd, "branch", "--show-current")).stdout.trim(), "main");
  assert.deepEqual(summary.branches, ["main", "source"]);
});

test("updates the origin remote URL", async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-desktop-git-remote-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await git(cwd, "init", "--initial-branch=main");
  await git(cwd, "remote", "add", "origin", "https://example.com/old.git");

  const { runGitAction } = await loadSubject();
  const summary = await runGitAction(cwd, "set_remote_url", { remoteUrl: "https://example.com/new.git" });

  assert.equal((await git(cwd, "remote", "get-url", "origin")).stdout.trim(), "https://example.com/new.git");
  assert.equal(summary.remote, "https://example.com/new.git");
});

test("surfaces the saved username on an HTTPS remote without leaking secrets", () => {
  assert.match(source, /savedCredentialUsername: string \| null/);
  assert.match(source, /loadGitCredential\(remote\)/);
  assert.match(source, /username \?\? null/);
  // The GitSummary must never carry a secret field back to the browser.
  const summaryShape = source.match(/export interface GitSummary \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(summaryShape);
  assert.doesNotMatch(summaryShape, /secret/i);
});
