import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildChatModeSystemPrompt } = await jiti.import("./chat-mode-prompt.ts");

test("replaces the coding prompt with a conversation prompt in both locales", () => {
  const zh = buildChatModeSystemPrompt("zh-CN");
  const en = buildChatModeSystemPrompt("en");

  assert.match(zh, /普通对话模式/);
  assert.match(en, /CHAT MODE/);
  assert.notEqual(zh, en);
  // 编码代理的提示词特征不能出现在普通对话模式里。
  assert.doesNotMatch(zh, /编程代理框架|可用工具：/);
  assert.doesNotMatch(en, /coding agent harness|Available tools:/);
});

test("states the tool-less boundary and how to get back to work mode", () => {
  const zh = buildChatModeSystemPrompt("zh-CN");
  const en = buildChatModeSystemPrompt("en");

  assert.match(zh, /没有启用任何工具/);
  assert.match(zh, /不能读取或修改文件、执行命令/);
  assert.match(zh, /π 图标切回「工作模式」/);
  assert.match(en, /No tools are enabled in this session/);
  assert.match(en, /π mark on the left of the input box/);
});

test("keeps the interface-language rule as the last paragraph", () => {
  const zh = buildChatModeSystemPrompt("zh-CN");
  const en = buildChatModeSystemPrompt("en");

  assert.ok(zh.trimEnd().endsWith("才可以使用其他语言。"));
  assert.ok(en.trimEnd().endsWith("Switch languages only when the user explicitly asks you to do so."));
});
