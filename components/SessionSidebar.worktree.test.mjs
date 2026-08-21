import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

test("uses the server-resolved current worktree identity", () => {
  assert.match(source, /currentWorktreePath: string \| null/);
  assert.match(
    source,
    /const currentWorktree =[\s\S]*?worktreeState\.currentWorktreePath[\s\S]*?worktree\.path === worktreeState\.currentWorktreePath/,
  );
  assert.match(source, /if \(currentWorktreePath === path\) setSelectedCwd\(worktreeState\.projectRoot\)/);
  assert.doesNotMatch(source, /const isCurrent = wt\.path === selectedCwd/);
});

test("loads and renders local Git branches in the worktree dropdown", () => {
  assert.match(source, /branches: string\[\]/);
  assert.match(source, /branches: d\.branches \?\? \[\]/);
  assert.match(source, /sidebar\.localBranches/);
  assert.match(source, /handleBranchGitAction\(action, "", selectedCwd\)/);
  assert.match(source, /sidebar\.pull/);
  assert.match(source, /sidebar\.push/);
  assert.match(source, /action: "checkout"/);
});

test("renames a local branch through the in-app dialog", () => {
  assert.match(source, /setRenameBranchDialog\(branch\)/);
  assert.match(source, /<RenameBranchDialog/);
  assert.match(source, /handleBranchGitAction\("rename_branch", renameBranchDialog, selectedCwd, undefined, renamedBranchName\.trim\(\)\)/);
  assert.doesNotMatch(source, /window\.prompt\(t\("sidebar\.renameBranchPrompt"/);
});

test("merges a selected local branch into a chosen local target", () => {
  assert.match(source, /sidebar\.mergeBranch/);
  assert.match(source, /setMergeBranchDialog\(branch\)/);
  assert.match(source, /<MergeBranchDialog/);
  assert.match(source, /handleBranchGitAction\("merge_branch", mergeBranchDialog/);
});

test("confirms branch deletion in-app before deleting a linked worktree", () => {
  assert.match(source, /setDeleteBranchDialog\(\{ branch, remote: false/);
  assert.match(source, /setDeleteBranchDialog\(\{ branch, remote: true/);
  assert.match(source, /<DeleteBranchDialog/);
  assert.match(source, /action === "delete_branch" && linkedWorktreePath/);
  assert.match(source, /method: "DELETE"[\s\S]*?path: linkedWorktreePath/);
  assert.match(source, /forceLinkedWorktree: true/);
  assert.match(source, /!isCurrent && !branchWorktree\?\.isMain/);
  assert.doesNotMatch(source, /window\.confirm\(confirmation\)/);
});
