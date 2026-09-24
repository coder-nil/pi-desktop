import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  CHAT_APPEARANCE_INIT_SCRIPT,
  CHAT_CONTENT_FONT_SIZE_DEFAULT,
  CHAT_CONTENT_FONT_SIZE_MAX,
  CHAT_CONTENT_FONT_SIZE_MIN,
  CHAT_CONTENT_MAX_WIDTH_VARIABLE,
  CHAT_CONTENT_FONT_SIZE_VARIABLE,
  CHAT_CONTENT_WIDTH_DEFAULT,
  CHAT_CONTENT_WIDTH_MAX,
  CHAT_CONTENT_WIDTH_MIN,
  applyChatAppearance,
  clampChatContentFontSize,
  clampChatContentWidth,
  readChatAppearance,
  writeChatAppearance,
} = await jiti.import("./chat-appearance.ts");

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

function createTarget() {
  const properties = {};
  return {
    properties,
    style: {
      setProperty(name, value) {
        properties[name] = value;
      },
    },
  };
}

test("clamps chat content width into the supported range", () => {
  assert.equal(clampChatContentWidth(CHAT_CONTENT_WIDTH_MIN - 100), CHAT_CONTENT_WIDTH_MIN);
  // The minimum already equals the default: content never gets narrower than
  // the reading column it shipped with.
  assert.equal(CHAT_CONTENT_WIDTH_MIN, CHAT_CONTENT_WIDTH_DEFAULT);
  assert.equal(clampChatContentWidth(CHAT_CONTENT_WIDTH_MAX + 500), CHAT_CONTENT_WIDTH_MAX);
  assert.equal(clampChatContentWidth("1234.6"), 1235);
  assert.equal(clampChatContentWidth("nonsense"), CHAT_CONTENT_WIDTH_DEFAULT);
  assert.equal(clampChatContentWidth(undefined), CHAT_CONTENT_WIDTH_DEFAULT);
});

test("clamps chat content font size into the supported range", () => {
  assert.equal(clampChatContentFontSize(CHAT_CONTENT_FONT_SIZE_MIN - 4), CHAT_CONTENT_FONT_SIZE_MIN);
  assert.equal(clampChatContentFontSize(CHAT_CONTENT_FONT_SIZE_MAX + 4), CHAT_CONTENT_FONT_SIZE_MAX);
  assert.equal(clampChatContentFontSize("16"), 16);
  assert.equal(clampChatContentFontSize(null), CHAT_CONTENT_FONT_SIZE_DEFAULT);
  assert.equal(clampChatContentFontSize("x"), CHAT_CONTENT_FONT_SIZE_DEFAULT);
});

test("reads defaults when nothing is stored and falls back per value", () => {
  assert.deepEqual(readChatAppearance(null), {
    width: CHAT_CONTENT_WIDTH_DEFAULT,
    fontSize: CHAT_CONTENT_FONT_SIZE_DEFAULT,
  });

  assert.deepEqual(readChatAppearance(createStorage()), {
    width: CHAT_CONTENT_WIDTH_DEFAULT,
    fontSize: CHAT_CONTENT_FONT_SIZE_DEFAULT,
  });

  // A corrupted width must not take the stored font size down with it.
  assert.deepEqual(
    readChatAppearance(createStorage({ "pi-chat-content-width": "wide", "pi-chat-content-font-size": "18" })),
    { width: CHAT_CONTENT_WIDTH_DEFAULT, fontSize: 18 },
  );
});

test("persists one value at a time and returns the next appearance", () => {
  const storage = createStorage();
  const initial = readChatAppearance(storage);

  const wider = writeChatAppearance(initial, "width", 1200, storage);
  assert.deepEqual(wider, { width: 1200, fontSize: CHAT_CONTENT_FONT_SIZE_DEFAULT });
  assert.equal(storage.values.get("pi-chat-content-width"), "1200");

  const larger = writeChatAppearance(wider, "fontSize", 17, storage);
  assert.deepEqual(larger, { width: 1200, fontSize: 17 });
  assert.equal(storage.values.get("pi-chat-content-font-size"), "17");

  // Clamping happens on write too, so a hostile value never reaches storage.
  assert.deepEqual(writeChatAppearance(larger, "fontSize", 999, storage), { width: 1200, fontSize: CHAT_CONTENT_FONT_SIZE_MAX });
});

test("keeps working when browser storage throws", () => {
  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };

  assert.deepEqual(readChatAppearance(blocked), {
    width: CHAT_CONTENT_WIDTH_DEFAULT,
    fontSize: CHAT_CONTENT_FONT_SIZE_DEFAULT,
  });
  assert.deepEqual(writeChatAppearance({ width: 900, fontSize: 15 }, "width", 1000, blocked), { width: 1000, fontSize: 15 });
});

test("publishes the appearance as custom properties", () => {
  const target = createTarget();

  applyChatAppearance({ width: 1180, fontSize: 16 }, target);

  assert.equal(target.properties[CHAT_CONTENT_MAX_WIDTH_VARIABLE], "1180px");
  assert.equal(target.properties[CHAT_CONTENT_FONT_SIZE_VARIABLE], "16px");
  assert.doesNotThrow(() => applyChatAppearance({ width: 820, fontSize: 14 }, null));
});

test("the first-paint script restores both values with clamping", () => {
  assert.match(CHAT_APPEARANCE_INIT_SCRIPT, /pi-chat-content-width/);
  assert.match(CHAT_APPEARANCE_INIT_SCRIPT, /pi-chat-content-font-size/);
  assert.match(CHAT_APPEARANCE_INIT_SCRIPT, new RegExp(`--chat-content-max-width`));
  assert.match(CHAT_APPEARANCE_INIT_SCRIPT, /setProperty/);
  // Values are clamped inline because the script cannot import the helpers.
  assert.match(CHAT_APPEARANCE_INIT_SCRIPT, new RegExp(String(CHAT_CONTENT_WIDTH_MAX)));
  assert.match(CHAT_APPEARANCE_INIT_SCRIPT, new RegExp(String(CHAT_CONTENT_FONT_SIZE_MAX)));
});
