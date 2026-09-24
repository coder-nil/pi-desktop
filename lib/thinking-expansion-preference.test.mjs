import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  THINKING_EXPANDED_EVENT,
  isThinkingExpandedByDefault,
  setThinkingExpandedByDefault,
} = await jiti.import("./thinking-expansion-preference.ts");

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("thinking blocks start collapsed unless the preference says otherwise", () => {
  assert.equal(isThinkingExpandedByDefault(null), false);
  assert.equal(isThinkingExpandedByDefault(createStorage()), false);
  // 只有明确的 "true" 才算打开，其余脏值一律按收起处理。
  assert.equal(isThinkingExpandedByDefault(createStorage({ "pi-thinking-expanded": "1" })), false);
  assert.equal(isThinkingExpandedByDefault(createStorage({ "pi-thinking-expanded": "true" })), true);
});

test("persists the preference and broadcasts it to mounted blocks", () => {
  const storage = createStorage();
  const events = [];

  setThinkingExpandedByDefault(true, storage, () => events.push(THINKING_EXPANDED_EVENT));
  assert.equal(storage.values.get("pi-thinking-expanded"), "true");
  assert.equal(isThinkingExpandedByDefault(storage), true);
  assert.deepEqual(events, [THINKING_EXPANDED_EVENT]);

  setThinkingExpandedByDefault(false, storage, () => events.push(THINKING_EXPANDED_EVENT));
  assert.equal(storage.values.get("pi-thinking-expanded"), "false");
  assert.equal(isThinkingExpandedByDefault(storage), false);
  assert.equal(events.length, 2);
});

test("survives blocked storage without throwing", () => {
  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  let dispatched = 0;

  assert.equal(isThinkingExpandedByDefault(blocked), false);
  assert.doesNotThrow(() => setThinkingExpandedByDefault(true, blocked, () => { dispatched += 1; }));
  // 广播仍然发出：不可写不该让已经打开的界面失去响应。
  assert.equal(dispatched, 1);
});
