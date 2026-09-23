import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  readPluginDownloads,
  writePluginDownloads,
  clearPluginDownloads,
} = await jiti.import("./plugin-downloads-store.ts");

async function withDatabase(t) {
  const directory = await mkdtemp(join(tmpdir(), "pi-desktop-plugin-downloads-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, "pi.sqlite");
}

test("merges persisted npm download counts across writes", async (t) => {
  const databasePath = await withDatabase(t);

  assert.equal(readPluginDownloads(databasePath), null);
  writePluginDownloads({ monthly: { alpha: 10 }, weekly: { alpha: 3 } }, databasePath);
  writePluginDownloads({ monthly: { beta: 20 } }, databasePath);

  const stored = readPluginDownloads(databasePath);
  assert.deepEqual(stored?.monthly, { alpha: 10, beta: 20 });
  assert.deepEqual(stored?.weekly, { alpha: 3 });
  assert.ok(typeof stored?.fetchedAt === "number" && stored.fetchedAt > 0);
});

test("ignores empty writes instead of replacing the cache", async (t) => {
  const databasePath = await withDatabase(t);

  writePluginDownloads({ monthly: { alpha: 10 } }, databasePath);
  writePluginDownloads({ monthly: {} }, databasePath);
  assert.deepEqual(readPluginDownloads(databasePath)?.monthly, { alpha: 10 });

  clearPluginDownloads(databasePath);
  assert.equal(readPluginDownloads(databasePath), null);
});

test("drops invalid counts and tolerates a corrupt cache", async (t) => {
  const databasePath = await withDatabase(t);

  writePluginDownloads({ monthly: { alpha: 10, bad: Number.NaN } }, databasePath);
  assert.deepEqual(readPluginDownloads(databasePath)?.monthly, { alpha: 10 });
});
