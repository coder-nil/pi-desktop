import test from "node:test";
import assert from "node:assert/strict";

async function loadSubject() {
  return import("./session-paging.ts");
}

let nextId = 0;
function user(text = "u") {
  return { role: "user", content: text };
}
function assistant(text = "a") {
  return { role: "assistant", content: [{ type: "text", text }], model: "m", provider: "p" };
}
function compaction(summary = "s") {
  return { role: "custom", customType: "compaction", content: summary, display: true };
}

function context(messages) {
  return { messages, entryIds: messages.map(() => `e${nextId++}`) };
}

/** n turns, each: user + assistant */
function turns(n) {
  const messages = [];
  for (let i = 0; i < n; i += 1) {
    messages.push(user(`u${i}`), assistant(`a${i}`));
  }
  return messages;
}

test("clamps the requested page size", async () => {
  const { clampSessionPageSize, SESSION_PAGE_SIZE, SESSION_PAGE_MAX } = await loadSubject();
  assert.equal(clampSessionPageSize(undefined), SESSION_PAGE_SIZE);
  assert.equal(clampSessionPageSize("40"), 40);
  assert.equal(clampSessionPageSize(0), SESSION_PAGE_SIZE);
  assert.equal(clampSessionPageSize(-5), SESSION_PAGE_SIZE);
  assert.equal(clampSessionPageSize("abc"), SESSION_PAGE_SIZE);
  assert.equal(clampSessionPageSize(10_000), SESSION_PAGE_MAX);
});

test("returns the whole context when it fits in one page", async () => {
  const { tailContextWindow } = await loadSubject();
  const ctx = context(turns(3));
  const window = tailContextWindow(ctx, 50);
  assert.equal(window.hasEarlier, false);
  assert.equal(window.totalMessages, 6);
  assert.deepEqual(window.messages, ctx.messages);
  assert.deepEqual(window.entryIds, ctx.entryIds);
});

test("takes the newest page and aligns its start to a turn boundary", async () => {
  const { tailContextWindow } = await loadSubject();
  const ctx = context(turns(100));
  const window = tailContextWindow(ctx, 10);
  // 190 is already a user prompt, so the window is exactly one page long.
  assert.equal(window.startIndex, 190);
  assert.equal(window.messages[0].role, "user");
  assert.equal(window.messages.length, 10);
  assert.equal(window.hasEarlier, true);
  assert.equal(window.totalMessages, 200);
  assert.equal(window.entryIds.length, window.messages.length);
});

test("walks a mid-turn window start back to the prompt that opened it", async () => {
  const { tailContextWindow } = await loadSubject();
  const ctx = context([user("u0"), assistant("a0"), assistant("a1"), user("u1"), assistant("a2"), assistant("a3")]);
  const window = tailContextWindow(ctx, 2);
  // Raw start index 4 is an assistant entry inside turn 2.
  assert.equal(window.startIndex, 3);
  assert.equal(window.messages[0].role, "user");
  assert.equal(window.messages.length, 3);
  assert.equal(window.hasEarlier, true);
});

test("keeps a compaction summary as a valid window start", async () => {
  const { tailContextWindow } = await loadSubject();
  const messages = [user("old"), ...turns(6)];
  messages.push(compaction(), assistant("after"), user("next"), assistant("done"));
  const ctx = context(messages);
  const window = tailContextWindow(ctx, 3);
  assert.equal(window.messages[0].role, "custom");
  assert.equal(window.messages[0].customType, "compaction");
  assert.equal(window.hasEarlier, true);
});

test("pages backwards from an entry id without repeating it", async () => {
  const { earlierContextWindow } = await loadSubject();
  const ctx = context(turns(50));
  const tail = (await loadSubject()).tailContextWindow(ctx, 20);
  const older = earlierContextWindow(ctx, tail.entryIds[0], 20);
  assert.equal(older.messages.length + tail.messages.length, 40);
  assert.equal(older.hasEarlier, true);
  assert.equal(older.entryIds.at(-1), ctx.entryIds[tail.startIndex - 1]);
  assert.equal(older.messages[0].role, "user");
});

test("reports no earlier history for an unknown entry id", async () => {
  const { earlierContextWindow } = await loadSubject();
  const ctx = context(turns(5));
  const older = earlierContextWindow(ctx, "missing", 20);
  assert.deepEqual(older.messages, []);
  assert.deepEqual(older.entryIds, []);
  assert.equal(older.hasEarlier, false);
  assert.equal(earlierContextWindow(ctx, null, 20).hasEarlier, false);
});

test("paging all the way back reaches the first message exactly once", async () => {
  const { tailContextWindow, earlierContextWindow } = await loadSubject();
  const ctx = context(turns(30));
  let window = tailContextWindow(ctx, 7);
  const seen = [...window.entryIds];
  while (window.hasEarlier) {
    window = earlierContextWindow(ctx, window.entryIds[0], 7);
    seen.unshift(...window.entryIds);
  }
  assert.deepEqual(seen, ctx.entryIds);
});

test("prepending merges an older page and skips duplicates", async () => {
  const { prependContextPage } = await loadSubject();
  const ctx = context(turns(10));
  const current = { messages: ctx.messages.slice(8), entryIds: ctx.entryIds.slice(8) };
  const page = { messages: ctx.messages.slice(4, 10), entryIds: ctx.entryIds.slice(4, 10) };
  const merged = prependContextPage(current, page);
  assert.equal(merged.prepended, 4);
  assert.deepEqual(merged.entryIds, ctx.entryIds.slice(4));
  assert.deepEqual(merged.messages, ctx.messages.slice(4));
});

test("prepending an already loaded page changes nothing", async () => {
  const { prependContextPage } = await loadSubject();
  const ctx = context(turns(3));
  const current = { messages: ctx.messages, entryIds: ctx.entryIds };
  const merged = prependContextPage(current, { messages: ctx.messages, entryIds: ctx.entryIds });
  assert.equal(merged.prepended, 0);
  assert.equal(merged.messages, current.messages);
  assert.equal(merged.entryIds, current.entryIds);
});
