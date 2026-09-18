import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { describeToolCall, toMobileMessages, projectAssistantBlocks } = await jiti.import("./mobile-state.ts");

const SESSION = [
  { role: "user", content: "设置页 MCP 那段说明文字为什么没有铺满？", timestamp: 1 },
  {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "先读文件" },
      { type: "text", text: "我看一下那段代码。" },
      { type: "toolCall", id: "t1", name: "read", arguments: { path: "components/SettingsPanel.tsx" } },
    ],
    timestamp: 2,
  },
  { role: "toolResult", toolCallId: "t1", toolName: "read", content: [{ type: "text", text: "..." }] },
  { role: "assistant", content: [{ type: "text", text: "那段被 maxWidth 卡住了。" }], timestamp: 3 },
];

test("projects a session into plain-text mobile messages", () => {
  const projected = toMobileMessages(SESSION, ["e1", "e2", "e3", "e4"]);

  assert.deepEqual(projected.map((message) => message.id), ["e1", "e2", "e4"]);
  assert.deepEqual(projected.map((message) => message.role), ["user", "assistant", "assistant"]);
  // 工具结果不进手机视图，思考过程也不进正文。
  assert.ok(!projected.some((message) => message.text.includes("先读文件")));
  assert.ok(!projected.some((message) => message.tools?.some((tool) => tool.startsWith("toolResult"))));
});

test("collapses tool calls into one readable line", () => {
  const projected = toMobileMessages(SESSION, ["e1", "e2", "e3", "e4"]);
  assert.deepEqual(projected[1].tools, ["read components/SettingsPanel.tsx"]);
  assert.equal(projected[1].text, "我看一下那段代码。");
});

test("describes tool arguments in preference order and truncates long hints", () => {
  assert.equal(describeToolCall("bash", { command: "npm test\n--watch" }), "bash npm test");
  assert.equal(describeToolCall("edit", { path: "a.ts", command: "ignored" }), "edit a.ts");
  assert.equal(describeToolCall("search", {}), "search");
  const long = describeToolCall("read", { path: "x".repeat(200) });
  assert.ok(long.length < 90, long);
  assert.ok(long.endsWith("..."), long);
});

test("keeps only the newest messages and truncates very long text", () => {
  const many = Array.from({ length: 40 }, (_, index) => ({
    role: "user",
    content: `消息 ${index}`,
  }));
  const projected = toMobileMessages(many, [], 5);
  assert.equal(projected.length, 5);
  assert.equal(projected.at(-1).text, "消息 39");

  const long = toMobileMessages([{ role: "user", content: "x".repeat(5000) }], ["e1"]);
  assert.ok(long[0].text.length < 1700, String(long[0].text.length));
  assert.ok(long[0].text.endsWith("…"));
});

test("counts attached images instead of rendering them", () => {
  const projected = toMobileMessages([
    { role: "user", content: [{ type: "text", text: "看这个" }, { type: "image" }, { type: "image" }] },
  ], ["e1"]);

  assert.match(projected[0].text, /看这个/);
  assert.match(projected[0].text, /\[2 images\]/);
});

test("projects the streaming tail the same way as stored messages", () => {
  const { text, tools } = projectAssistantBlocks([
    { type: "text", text: "正在改" },
    { type: "toolCall", id: "x", name: "edit", arguments: { path: "a.ts" } },
  ]);

  assert.equal(text, "正在改");
  assert.deepEqual(tools, ["edit a.ts"]);
});
