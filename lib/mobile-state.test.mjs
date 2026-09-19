import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  buildMobileWindow,
  describeToolCall,
  skimMobileMessage,
  toMobileMessages,
  projectAssistantBlocks,
} = await jiti.import("./mobile-state.ts");

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
  // 思考不进正文，而是单独的 thinking 字段；工具结果不单独成条。
  assert.ok(!projected.some((message) => message.text.includes("先读文件")));
  assert.equal(projected[1].thinking, "先读文件");
  assert.ok(!projected.some((message) => message.tools?.some((call) => call.name === "toolResult")));
});

test("keeps one readable line per tool call, with input and result for expanding", () => {
  const projected = toMobileMessages(SESSION, ["e1", "e2", "e3", "e4"]);
  const [call] = projected[1].tools;

  assert.equal(projected[1].text, "我看一下那段代码。");
  assert.equal(call.name, "read");
  assert.equal(call.hint, "components/SettingsPanel.tsx");
  assert.match(call.input, /"path": "components\/SettingsPanel\.tsx"/);
  assert.equal(call.output, "...");
  assert.ok(!call.isError);
});

test("truncates thinking and joins multiple thinking blocks", () => {
  const long = toMobileMessages([
    { role: "assistant", content: [{ type: "thinking", thinking: "想".repeat(3000) }, { type: "text", text: "好" }] },
  ], ["e1"]);
  assert.ok(long[0].thinking.length < 1300, String(long[0].thinking.length));
  assert.ok(long[0].thinking.endsWith("…"));

  const joined = toMobileMessages([
    { role: "assistant", content: [{ type: "thinking", thinking: "第一步" }, { type: "thinking", thinking: "第二步" }, { type: "text", text: "好" }] },
  ], ["e1"]);
  assert.equal(joined[0].thinking, "第一步\n\n第二步");
});

test("keeps thinking-only and tool-only assistant entries", () => {
  const projected = toMobileMessages([
    { role: "assistant", content: [{ type: "thinking", thinking: "先看看" }] },
    { role: "assistant", content: [{ type: "toolCall", id: "t9", name: "bash", arguments: { command: "ls" } }] },
  ], ["e1", "e2"]);

  assert.equal(projected.length, 2);
  assert.equal(projected[0].text, "");
  assert.deepEqual(projected[1].tools.map((call) => `${call.name} ${call.hint}`), ["bash ls"]);
});

test("shows raw tool input while the arguments are still streaming", () => {
  const projected = toMobileMessages([
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "t1", name: "edit", input: {}, rawInput: '{"path":"a.ts","old' }],
    },
  ], ["e1"]);

  // 流式块的 `arguments` 是占位 `{}`，不能盖住正在生成的 rawInput。
  assert.equal(projected[0].tools[0].input, '{"path":"a.ts","old');
});

test("marks failed tools and drops empty results", () => {
  const projected = toMobileMessages([
    { role: "assistant", content: [{ type: "toolCall", id: "t1", name: "read", arguments: { path: "a.ts" } }] },
    { role: "toolResult", toolCallId: "t1", isError: true, content: [{ type: "text", text: "ENOENT: no such file" }] },
    { role: "assistant", content: [{ type: "toolCall", id: "t2", name: "bash", arguments: { command: "true" } }] },
    { role: "toolResult", toolCallId: "t2", content: [{ type: "text", text: "(no output)" }] },
  ], ["e1", "e2", "e3", "e4"]);

  assert.equal(projected[0].tools[0].isError, true);
  assert.equal(projected[0].tools[0].output, "ENOENT: no such file");
  assert.equal(projected[1].tools[0].output, undefined);
  assert.equal(projected[1].tools[0].isError, undefined);
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

test("windows the newest messages and reports how many are left behind", () => {
  const many = Array.from({ length: 100 }, (_, index) => ({ role: "user", content: `消息 ${index}` }));
  const ids = many.map((_, index) => `e${index}`);

  const first = buildMobileWindow(many, ids, 30);
  assert.equal(first.messages.length, 30);
  assert.equal(first.messages[0].text, "消息 70");
  assert.equal(first.messages.at(-1).text, "消息 99");
  assert.equal(first.earlierCount, 70);

  // 翻到底：earlierCount 归零，最早的那条也能拿到。
  const all = buildMobileWindow(many, ids, 100);
  assert.equal(all.messages.length, 100);
  assert.equal(all.messages[0].text, "消息 0");
  assert.equal(all.earlierCount, 0);

  // 超过上限也只是窗口不再变长，不会报错。
  assert.equal(buildMobileWindow(many, ids, 500).messages.length, 100);
});

test("keeps details only for the newest slice of the window", () => {
  const messages = Array.from({ length: 6 }, (_, index) => ({
    role: "assistant",
    content: [
      { type: "thinking", thinking: `思路 ${index}` },
      { type: "text", text: `回答 ${index}` },
      { type: "toolCall", id: `t${index}`, name: "read", arguments: { path: `f${index}.ts` } },
    ],
  }));
  const results = messages.map((_, index) => ({
    role: "toolResult",
    toolCallId: `t${index}`,
    content: [{ type: "text", text: `输出 ${index}` }],
  }));

  const window = buildMobileWindow([...messages, ...results], [], 6, { detailWindow: 2 });

  // 最后两条保留思考与工具细节。
  for (const message of window.messages.slice(-2)) {
    assert.ok(message.thinking, "最新的两条应该带思考");
    assert.ok(message.tools[0].input, "最新的两条应该带工具入参");
  }
  // 更早的只剩正文 + 一行摘要。
  for (const message of window.messages.slice(0, -2)) {
    assert.equal(message.thinking, undefined);
    assert.equal(message.tools[0].input, undefined);
    assert.equal(message.tools[0].output, undefined);
    assert.equal(message.tools[0].name, "read");
    assert.match(message.tools[0].hint, /^f\d\.ts$/);
    assert.match(message.text, /^回答 \d$/);
  }
});

test("skimming drops detail without touching messages that have none", () => {
  const plain = { id: "e1", role: "user", text: "你好", at: "10:00" };
  assert.equal(skimMobileMessage(plain), plain);

  const detailed = {
    id: "e2",
    role: "assistant",
    text: "好了",
    thinking: "想想",
    tools: [{ id: "t1", name: "bash", hint: "npm test", input: "{}", output: "ok", isError: true }],
  };
  assert.deepEqual(skimMobileMessage(detailed), {
    id: "e2",
    role: "assistant",
    text: "好了",
    tools: [{ id: "t1", name: "bash", hint: "npm test", isError: true }],
  });
});

test("counts attached images instead of rendering them", () => {
  const projected = toMobileMessages([
    { role: "user", content: [{ type: "text", text: "看这个" }, { type: "image" }, { type: "image" }] },
  ], ["e1"]);

  assert.match(projected[0].text, /看这个/);
  assert.match(projected[0].text, /\[2 images\]/);
});

test("projects the streaming tail the same way as stored messages", () => {
  const { text, thinking, tools } = projectAssistantBlocks([
    { type: "thinking", thinking: "先看看" },
    { type: "text", text: "正在改" },
    { type: "toolCall", id: "x", name: "edit", arguments: { path: "a.ts" } },
  ]);

  assert.equal(text, "正在改");
  assert.equal(thinking, "先看看");
  assert.deepEqual(tools.map((call) => `${call.name} ${call.hint}`), ["edit a.ts"]);
  assert.equal(tools[0].id, "x");
  assert.match(tools[0].input, /a\.ts/);
});
