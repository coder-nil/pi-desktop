import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./GitPanel.tsx", import.meta.url), "utf8");

test("renders Git panel text through i18n", () => {
  assert.match(source, /import \{ useI18n \} from "@\/hooks\/useI18n"/);
  assert.match(source, /const \{ t \} = useI18n\(\)/);
  for (const key of ["git.loadingRepository", "git.notRepository", "git.commitStaged", "git.rebaseWhenPulling", "git.mergeBranch", "git.stage", "git.discardFileConfirm"]) {
    assert.match(source, new RegExp(`t\\("${key}"`));
  }
});

test("uses the selected session model to summarize staged changes", () => {
  assert.match(source, /sessionId: string \| null/);
  assert.match(source, /fetch\("\/api\/git\/commit-message"/);
  assert.match(source, /setMessage\(data\.message\)/);
  assert.match(source, /git\.summarizeCommit/);
});

test("selects a non-current local branch to merge with a custom picker", () => {
  assert.match(source, /branches: string\[\]/);
  assert.match(source, /summary\?\.branches\.filter\(\(branch\) => branch !== summary\.branch\)/);
  assert.match(source, /<MergeBranchPicker branches=\{mergeBranches\}/);
  assert.match(source, /role="combobox"/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /git\.selectBranch/);
  assert.doesNotMatch(source, /<select value=\{mergeBranch\}/);
});
