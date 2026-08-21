import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

test("merges source commits into the requested target branch", async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-web-git-merge-"));
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
