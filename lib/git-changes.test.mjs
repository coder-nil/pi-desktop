import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function git(cwd, ...args) {
  return execFileAsync("git", ["-C", cwd, ...args]);
}

async function loadSubject() {
  return import("./git-status.ts");
}

async function loadChanges() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./git-changes.ts");
}

test("parses null-delimited Git status entries including renames", async () => {
  const { parseGitPorcelainV1 } = await loadSubject();
  const entries = parseGitPorcelainV1([
    " M components/App.tsx",
    "?? notes.txt",
    "R  src/new-name.ts",
    "src/old-name.ts",
    "",
  ].join("\0"));

  assert.deepEqual(entries, [
    {
      path: "components/App.tsx",
      indexStatus: " ",
      worktreeStatus: "M",
    },
    {
      path: "notes.txt",
      indexStatus: "?",
      worktreeStatus: "?",
    },
    {
      path: "src/new-name.ts",
      originalPath: "src/old-name.ts",
      indexStatus: "R",
      worktreeStatus: " ",
    },
  ]);
});

test("classifies Git status for explorer badges", async () => {
  const { classifyGitStatus } = await loadSubject();
  const classify = (pair) => classifyGitStatus({
    path: "file.ts",
    indexStatus: pair[0],
    worktreeStatus: pair[1],
  });

  assert.deepEqual(classify(" M"), { status: "modified", code: "M" });
  assert.deepEqual(classify("??"), { status: "untracked", code: "U" });
  assert.deepEqual(classify("A "), { status: "added", code: "A" });
  assert.deepEqual(classify("R "), { status: "renamed", code: "R" });
  assert.deepEqual(classify("UU"), { status: "conflict", code: "C" });
  assert.deepEqual(classify(" D"), { status: "deleted", code: "D" });
});

test("lists exactly the untracked paths that git clean -fd would delete", async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-desktop-git-untracked-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await git(cwd, "init", "--initial-branch=main");
  await git(cwd, "config", "user.email", "test@example.com");
  await git(cwd, "config", "user.name", "Test User");
  await writeFile(path.join(cwd, "tracked.txt"), "tracked\n");
  await writeFile(path.join(cwd, ".gitignore"), "build/\n");
  await git(cwd, "add", "tracked.txt", ".gitignore");
  await git(cwd, "commit", "-m", "initial");

  await writeFile(path.join(cwd, "loose.txt"), "loose\n");
  await mkdir(path.join(cwd, "nested"), { recursive: true });
  await writeFile(path.join(cwd, "nested", "deep.txt"), "deep\n");
  await mkdir(path.join(cwd, "empty"), { recursive: true });
  await mkdir(path.join(cwd, "build"), { recursive: true });
  await writeFile(path.join(cwd, "build", "output.js"), "built\n");

  const { listUntrackedPaths } = await loadChanges();
  const names = (await listUntrackedPaths(cwd)).map((filePath) => path.relative(cwd, filePath));

  // Ignored build output and empty directories survive `git clean -fd`, so they
  // must stay out of the confirmation list: it promises what will be deleted.
  assert.deepEqual(names, ["loose.txt", "nested"]);
});

test("lists untracked paths relative to the repository, not the session cwd", async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-desktop-git-untracked-cwd-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await git(cwd, "init", "--initial-branch=main");
  await git(cwd, "config", "user.email", "test@example.com");
  await git(cwd, "config", "user.name", "Test User");
  await writeFile(path.join(cwd, "tracked.txt"), "tracked\n");
  await git(cwd, "add", "tracked.txt");
  await git(cwd, "commit", "-m", "initial");
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await writeFile(path.join(cwd, "root-only.txt"), "root\n");

  const { getGitStatus, listUntrackedPaths } = await loadChanges();

  // getGitStatus only reports files inside the given cwd, which is why the Git
  // panel cannot build the discard-all confirmation from it.
  assert.deepEqual((await getGitStatus(path.join(cwd, "src"))).files, []);
  assert.deepEqual(
    (await listUntrackedPaths(cwd)).map((filePath) => path.relative(cwd, filePath)),
    ["root-only.txt"],
  );
});

test("keeps symlinks in the untracked deletion list because clean -fd removes them", async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-desktop-git-untracked-link-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await git(cwd, "init", "--initial-branch=main");
  await git(cwd, "config", "user.email", "test@example.com");
  await git(cwd, "config", "user.name", "Test User");
  await writeFile(path.join(cwd, "tracked.txt"), "tracked\n");
  await git(cwd, "add", "tracked.txt");
  await git(cwd, "commit", "-m", "initial");
  await symlink(path.join(cwd, "tracked.txt"), path.join(cwd, "link.txt"));

  const { listUntrackedPaths } = await loadChanges();

  // The list has to mirror `git clean -fdn`; a symlink is a real removal target.
  assert.deepEqual(
    (await listUntrackedPaths(cwd)).map((filePath) => path.relative(cwd, filePath)),
    ["link.txt"],
  );
});
