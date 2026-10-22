import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  DEFAULT_QUEUE_MODE,
  parseQueueMode,
  readQueueModes,
  writeQueueModes,
} = await jiti.import("./queue-mode-settings.ts");

async function withSettings(content, run) {
  const dir = await mkdtemp(join(tmpdir(), "pi-queue-mode-"));
  const settingsPath = join(dir, "settings.json");
  if (content !== null) await writeFile(settingsPath, content, "utf8");
  try {
    await run(settingsPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("falls back to pi's default instead of failing on a hand-edited value", () => {
  assert.equal(DEFAULT_QUEUE_MODE, "one-at-a-time");
  assert.equal(parseQueueMode("all"), "all");
  assert.equal(parseQueueMode("one-at-a-time"), "one-at-a-time");
  // 一个手改坏掉的值不能让会话读不出模式。
  assert.equal(parseQueueMode("batch"), DEFAULT_QUEUE_MODE);
  assert.equal(parseQueueMode(undefined), DEFAULT_QUEUE_MODE);
});

test("reads a missing settings file as the defaults", async () => {
  await withSettings(null, async (settingsPath) => {
    assert.deepEqual(await readQueueModes(settingsPath), {
      steeringMode: DEFAULT_QUEUE_MODE,
      followUpMode: DEFAULT_QUEUE_MODE,
    });
  });
});

test("writes both modes without dropping unrelated settings", async () => {
  await withSettings(JSON.stringify({ defaultModel: "anthropic/claude", steeringMode: "all" }), async (settingsPath) => {
    const written = await writeQueueModes({ steeringMode: "one-at-a-time", followUpMode: "all" }, settingsPath);
    assert.deepEqual(written, { steeringMode: "one-at-a-time", followUpMode: "all" });

    const stored = JSON.parse(await readFile(settingsPath, "utf8"));
    // pi 自己的字段，CLI 与桌面端共用同一个文件。
    assert.equal(stored.steeringMode, "one-at-a-time");
    assert.equal(stored.followUpMode, "all");
    // 其余设置与 $schema 必须留下，否则一次保存会把别人的配置抹掉。
    assert.equal(stored.defaultModel, "anthropic/claude");
    assert.equal(typeof stored.$schema, "string");
  });
});

test("a single-field patch leaves the other mode alone", async () => {
  await withSettings(JSON.stringify({ steeringMode: "all", followUpMode: "all" }), async (settingsPath) => {
    assert.deepEqual(await writeQueueModes({ followUpMode: "one-at-a-time" }, settingsPath), {
      steeringMode: "all",
      followUpMode: "one-at-a-time",
    });
  });
});

test("refuses an empty patch instead of writing nothing", async () => {
  await withSettings("{}", async (settingsPath) => {
    await assert.rejects(() => writeQueueModes({}, settingsPath));
  });
});
