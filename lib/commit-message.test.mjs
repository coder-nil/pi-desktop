import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./commit-message.ts");
}

test("normalizes generated commit messages", async () => {
  const { parseGeneratedCommitMessage } = await loadSubject();
  assert.equal(parseGeneratedCommitMessage("Commit message: Add Git branch picker\n\nDetails"), "Add Git branch picker");
  assert.equal(parseGeneratedCommitMessage("`修复提交说明生成`"), "修复提交说明生成");
  assert.throws(() => parseGeneratedCommitMessage("---"), /usable commit message/);
});
