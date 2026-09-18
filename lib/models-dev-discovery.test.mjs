import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { getModelsDevCatalog, refreshModelsDevCatalog } = await jiti.import("./models-dev-discovery.ts");

const FRESH_TTL_MS = 60 * 60 * 1000;
const EXPIRED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function payload(...ids) {
  return {
    deepseek: {
      id: "deepseek",
      name: "DeepSeek",
      api: "https://api.deepseek.com",
      models: Object.fromEntries(ids.map((id) => [id, { id, name: id, cost: { input: 1, output: 2 } }])),
    },
  };
}

function ids(entries) {
  return entries.map((item) => item.id);
}

/** 每个用例都用内存缓存后端，绝不碰真实的 ~/.pi/agent/pi.sqlite。 */
function useStore(t, options = {}) {
  const previous = {
    cache: globalThis.__piModelsDevCatalogCache,
    refresh: globalThis.__piModelsDevCatalogRefresh,
    retryAt: globalThis.__piModelsDevCatalogRetryAt,
    store: globalThis.__piModelsDevCatalogStore,
  };
  const writes = [];
  globalThis.__piModelsDevCatalogCache = undefined;
  globalThis.__piModelsDevCatalogRefresh = undefined;
  globalThis.__piModelsDevCatalogRetryAt = undefined;
  globalThis.__piModelsDevCatalogStore = {
    read: () => options.stored ?? null,
    write: (entries) => writes.push(ids(entries)),
  };
  t.after(() => {
    globalThis.__piModelsDevCatalogCache = previous.cache;
    globalThis.__piModelsDevCatalogRefresh = previous.refresh;
    globalThis.__piModelsDevCatalogRetryAt = previous.retryAt;
    globalThis.__piModelsDevCatalogStore = previous.store;
  });
  return writes;
}

test("serves a fresh database catalog without touching the network", async (t) => {
  const storedEntry = { key: "deepseek/cached", providerId: "deepseek", providerName: "DeepSeek", id: "cached", name: "cached", cost: {}, input: ["text"] };
  useStore(t, { stored: { entries: [storedEntry], fetchedAt: Date.now() - FRESH_TTL_MS } });
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("unexpected models.dev request");
  });

  const entries = await getModelsDevCatalog();

  assert.deepEqual(ids(entries), ["cached"]);
  assert.equal(globalThis.__piModelsDevCatalogRefresh, undefined);
});

test("returns an expired catalog immediately and refreshes it in the background", async (t) => {
  const storedEntry = { key: "deepseek/old", providerId: "deepseek", providerName: "DeepSeek", id: "old", name: "old", cost: {}, input: ["text"] };
  const writes = useStore(t, { stored: { entries: [storedEntry], fetchedAt: Date.now() - EXPIRED_TTL_MS } });
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests += 1;
    return Response.json(payload("fresh"));
  });

  const entries = await getModelsDevCatalog();
  assert.deepEqual(ids(entries), ["old"]);

  const refreshing = globalThis.__piModelsDevCatalogRefresh;
  assert.ok(refreshing, "an expired catalog starts a background refresh");
  await refreshing;

  assert.equal(requests, 1);
  assert.deepEqual(writes, [["fresh"]]);
  assert.deepEqual(ids(await getModelsDevCatalog()), ["fresh"]);
});

test("only reads the network when no cached catalog exists", async (t) => {
  const writes = useStore(t);
  t.mock.method(globalThis, "fetch", async () => Response.json(payload("fetched")));

  assert.deepEqual(ids(await getModelsDevCatalog()), ["fetched"]);
  assert.deepEqual(writes, [["fetched"]]);
});

test("offline reads never hit the network", async (t) => {
  useStore(t);
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("unexpected models.dev request");
  });

  assert.deepEqual(await getModelsDevCatalog({ offline: true }), []);
});

test("keeps refreshing an expired catalog that was first loaded offline", async (t) => {
  const storedEntry = { key: "deepseek/old", providerId: "deepseek", providerName: "DeepSeek", id: "old", name: "old", cost: {}, input: ["text"] };
  const writes = useStore(t, { stored: { entries: [storedEntry], fetchedAt: Date.now() - EXPIRED_TTL_MS } });
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests += 1;
    return Response.json(payload("fresh"));
  });

  // 会话启动会先做一次不访问网络的恢复式读取，它不能把过期条目当成新鲜数据。
  assert.deepEqual(ids(await getModelsDevCatalog({ offline: true })), ["old"]);

  const entries = await getModelsDevCatalog();
  assert.deepEqual(ids(entries), ["old"]);

  const refreshing = globalThis.__piModelsDevCatalogRefresh;
  assert.ok(refreshing, "an offline-restored expired catalog still refreshes in the background");
  await refreshing;
  assert.equal(requests, 1);
  assert.deepEqual(writes, [["fresh"]]);
});

test("backs off after a failed background refresh", async (t) => {
  const storedEntry = { key: "deepseek/old", providerId: "deepseek", providerName: "DeepSeek", id: "old", name: "old", cost: {}, input: ["text"] };
  useStore(t, { stored: { entries: [storedEntry], fetchedAt: Date.now() - EXPIRED_TTL_MS } });
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests += 1;
    return new Response("boom", { status: 500 });
  });

  assert.deepEqual(ids(await getModelsDevCatalog()), ["old"]);
  await globalThis.__piModelsDevCatalogRefresh;

  assert.deepEqual(ids(await getModelsDevCatalog()), ["old"]);
  assert.equal(globalThis.__piModelsDevCatalogRefresh, undefined);
  assert.equal(requests, 2, "only the two allowlisted endpoints are tried");
});

test("force bypasses the cached catalog", async (t) => {
  const storedEntry = { key: "deepseek/cached", providerId: "deepseek", providerName: "DeepSeek", id: "cached", name: "cached", cost: {}, input: ["text"] };
  useStore(t, { stored: { entries: [storedEntry], fetchedAt: Date.now() } });
  t.mock.method(globalThis, "fetch", async () => Response.json(payload("forced")));

  assert.deepEqual(ids(await getModelsDevCatalog({ force: true })), ["forced"]);
});

test("falls back to the flat models.json endpoint", async (t) => {
  useStore(t);
  const requested = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    requested.push(String(url));
    if (String(url).endsWith("/api.json")) return new Response("nope", { status: 503 });
    return Response.json({ "deepseek/deepseek-chat": { id: "deepseek-chat", name: "DeepSeek Chat", cost: { input: 1, output: 2 } } });
  });

  const entries = await refreshModelsDevCatalog();

  assert.deepEqual(ids(entries), ["deepseek-chat"]);
  assert.deepEqual(requested, ["https://models.dev/api.json", "https://models.dev/models.json"]);
});
