import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  clearModelsDevCatalog,
  readModelsDevCatalog,
  writeModelsDevCatalog,
} = await jiti.import("./models-dev-catalog-store.ts");

function entry(id) {
  return {
    key: `deepseek/${id}`,
    providerId: "deepseek",
    providerName: "DeepSeek",
    id,
    name: id,
    cost: { input: 1, output: 2 },
    input: ["text"],
  };
}

async function withDatabase(t) {
  const directory = await mkdtemp(join(tmpdir(), "pi-desktop-models-dev-catalog-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, "pi.sqlite");
}

test("round-trips the cached models.dev catalog", async (t) => {
  const databasePath = await withDatabase(t);

  assert.equal(readModelsDevCatalog(databasePath), null);

  writeModelsDevCatalog([entry("deepseek-chat")], databasePath);
  const stored = readModelsDevCatalog(databasePath);

  assert.deepEqual(stored?.entries.map((item) => item.id), ["deepseek-chat"]);
  assert.ok(typeof stored?.fetchedAt === "number" && stored.fetchedAt > 0);
});

test("replaces the previous catalog instead of appending", async (t) => {
  const databasePath = await withDatabase(t);

  writeModelsDevCatalog([entry("old-a"), entry("old-b")], databasePath);
  writeModelsDevCatalog([entry("new-a")], databasePath);

  assert.deepEqual(readModelsDevCatalog(databasePath)?.entries.map((item) => item.id), ["new-a"]);
});

test("keeps usable cache when asked to store an empty catalog", async (t) => {
  const databasePath = await withDatabase(t);

  writeModelsDevCatalog([entry("deepseek-chat")], databasePath);
  writeModelsDevCatalog([], databasePath);

  assert.deepEqual(readModelsDevCatalog(databasePath)?.entries.map((item) => item.id), ["deepseek-chat"]);
});

test("treats unreadable rows as a cache miss", async (t) => {
  const databasePath = await withDatabase(t);
  writeModelsDevCatalog([entry("deepseek-chat")], databasePath);

  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec("UPDATE models_dev_catalog SET payload = 'not json' WHERE id = 1");
  database.close();

  assert.equal(readModelsDevCatalog(databasePath), null);
});

test("clears the cached catalog", async (t) => {
  const databasePath = await withDatabase(t);
  writeModelsDevCatalog([entry("deepseek-chat")], databasePath);

  clearModelsDevCatalog(databasePath);

  assert.equal(readModelsDevCatalog(databasePath), null);
});
