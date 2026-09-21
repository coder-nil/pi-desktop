import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildMobileTimeline, reconcilePendingUserMessages } = await jiti.import("./mobile-timeline.ts");

/** 只写关心的字段，其余交给投影层默认值。 */
function message(id, role, extra = {}) {
  return { id, role, text: "", ...extra };
}

/** 工具调用只关心条数，字段按 `MobileToolCall` 的最小形状给。 */
function tool(name = "read", hint = "src/a.ts") {
  return { id: `${name}-${hint}`, name, hint };
}

test("folds a turn's process into one group and keeps the final answer outside", () => {
  const timeline = buildMobileTimeline([
    message("u1", "user", { text: "改一下标题" }),
    message("a1", "assistant", { tools: [tool()] }),
    message("a2", "assistant", { text: "先看一下现有实现", tools: [tool("read", "src/b.ts")] }),
    message("a3", "assistant", { text: "改好了" }),
  ]);

  assert.deepEqual(timeline.map((item) => item.kind), ["user", "turn"]);
  const turn = timeline[1];
  assert.equal(turn.messageCount, 2);
  assert.equal(turn.toolCallCount, 2);
  assert.deepEqual(turn.process.map((entry) => entry.id), ["a1", "a2"]);
  assert.equal(turn.answer?.id, "a3");
});

test("counts the final answer's own tool calls into the collapsed group", () => {
  const timeline = buildMobileTimeline([
    message("u1", "user", { text: "跑一下测试" }),
    message("a1", "assistant", { text: "跑完了", tools: [tool("bash"), tool("bash")] }),
  ]);

  const turn = timeline[1];
  assert.equal(turn.messageCount, 0);
  assert.equal(turn.toolCallCount, 2);
  assert.equal(turn.answer?.id, "a1");
});

test("keeps a plain answer as a turn with nothing to collapse", () => {
  const timeline = buildMobileTimeline([
    message("u1", "user", { text: "你好" }),
    message("a1", "assistant", { text: "你好，有什么可以帮忙的？" }),
  ]);

  const turn = timeline[1];
  assert.equal(turn.messageCount, 0);
  assert.equal(turn.toolCallCount, 0);
  assert.equal(turn.answer?.id, "a1");
});

test("falls back to a tool-only turn when the run produced no answer", () => {
  const timeline = buildMobileTimeline([
    message("u1", "user", { text: "继续" }),
    message("a1", "assistant", { tools: [tool("edit")] }),
  ]);

  const turn = timeline[1];
  assert.equal(turn.answer, null);
  assert.equal(turn.messageCount, 1);
  assert.equal(turn.toolCallCount, 1);
  assert.equal(turn.process[0].id, "a1");
});

test("groups a window that starts mid-turn without a user anchor", () => {
  const timeline = buildMobileTimeline([
    message("a1", "assistant", { tools: [tool()] }),
    message("a2", "assistant", { text: "这是窗口里的第一条回答" }),
  ]);

  assert.deepEqual(timeline.map((item) => item.kind), ["turn"]);
  assert.equal(timeline[0].messageCount, 1);
  assert.equal(timeline[0].answer?.id, "a2");
});

test("starts a new group at every user message and ignores empty turns", () => {
  const timeline = buildMobileTimeline([
    message("u1", "user", { text: "第一轮" }),
    message("a1", "assistant", { tools: [tool()] }),
    message("a2", "assistant", { text: "第一轮答案" }),
    message("u2", "user", { text: "第二轮" }),
    message("u3", "user", { text: "还没回答就又问了一句" }),
    message("a3", "assistant", { text: "第二轮的答案" }),
  ]);

  assert.deepEqual(
    timeline.map((item) => (item.kind === "user" ? `user:${item.key}` : `turn:${item.messageCount}/${item.toolCallCount}`)),
    ["user:u1", "turn:1/1", "user:u2", "user:u3", "turn:0/0"],
  );
  assert.equal(timeline[4].answer?.id, "a3");
});

test("gives every item a stable key", () => {
  const timeline = buildMobileTimeline([
    message("u1", "user", { text: "hello" }),
    message("a1", "assistant", { tools: [tool()] }),
  ]);

  assert.deepEqual(timeline.map((item) => item.key), ["u1", "a1"]);
  assert.equal(new Set(timeline.map((item) => item.key)).size, timeline.length);
});

test("hands a pending bubble over once the snapshot carries a new matching entry", () => {
  const pending = [message("pending-0", "user", { text: "跑一下测试", at: "14:02" })];
  const snapshot = [message("u1", "user", { text: "跑一下测试" }), message("a1", "assistant", { text: "好的" })];

  assert.deepEqual(reconcilePendingUserMessages(pending, snapshot, new Set()), []);
});

test("keeps the pending bubble while the matching entry is an old one", () => {
  // 会话里本来就有一模一样的「继续」，此时刚发出去的那条还没落库，不能提前消失。
  const pending = [message("pending-0", "user", { text: "继续" })];
  const snapshot = [message("u1", "user", { text: "继续" })];

  const next = reconcilePendingUserMessages(pending, snapshot, new Set(["u1"]));
  assert.equal(next, pending);
});

test("consumes one new entry per identical pending bubble", () => {
  const pending = [
    message("pending-0", "user", { text: "继续" }),
    message("pending-1", "user", { text: "继续" }),
  ];
  const snapshot = [message("u9", "user", { text: "继续" })];

  assert.deepEqual(reconcilePendingUserMessages(pending, snapshot, new Set(["u1"])).map((m) => m.id), ["pending-1"]);
});

test("ignores assistant entries and returns the same list when nothing changed", () => {
  const pending = [message("pending-0", "user", { text: "跑一下测试" })];
  const snapshot = [
    message("u1", "user", { text: "跑一下测试" }),
    message("a1", "assistant", { text: "跑一下测试", tools: [tool("bash", "npm test")] }),
  ];

  assert.equal(reconcilePendingUserMessages(pending, snapshot, new Set(["u1", "a1"])), pending);
  // 没有待确认气泡时直接返回原数组。
  const empty = [];
  assert.equal(reconcilePendingUserMessages(empty, snapshot, new Set()), empty);
});
