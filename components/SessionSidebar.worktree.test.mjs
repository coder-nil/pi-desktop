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
  assert.match(source, /setWtRefreshKey\(\(key\) => key \+ 1\)/);
  assert.match(source, /aria-label=\{t\("sidebar\.refresh"\)\}/);
  assert.match(source, /action: "checkout"/);
});
