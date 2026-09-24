import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  getPreferredChatMode,
  setPreferredChatMode,
} = await jiti.import("./chat-mode-preference.ts");

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

test("defaults to work mode for missing or invalid values", () => {
  assert.equal(getPreferredChatMode(createStorage()), "work");
  assert.equal(getPreferredChatMode(createStorage({ "pi-chat-mode": "legacy" })), "work");
});

test("round-trips both modes", () => {
  const storage = createStorage();

  setPreferredChatMode("chat", storage);
  assert.equal(storage.values.get("pi-chat-mode"), "chat");
  assert.equal(getPreferredChatMode(storage), "chat");

  setPreferredChatMode("work", storage);
  assert.equal(getPreferredChatMode(storage), "work");
});

test("falls back safely when browser storage is unavailable", () => {
  const unavailable = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };

  assert.equal(getPreferredChatMode(unavailable), "work");
  assert.doesNotThrow(() => setPreferredChatMode("chat", unavailable));
  assert.equal(getPreferredChatMode(null), "work");
  assert.doesNotThrow(() => setPreferredChatMode("chat", null));
});
