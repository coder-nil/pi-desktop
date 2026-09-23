import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

// 路由模块只依赖 Next 的响应包装，这里直接调用它的 GET 并解析 JSON。
const { GET } = await jiti.import("./route.ts");

async function fetchCatalog(query) {
  const response = await GET(new Request(`http://localhost/api/plugins/catalog?${query}`));
  return { status: response.status, body: await response.json() };
}

test("pages deeper npm search results without repeating plugins", async () => {
  const { body } = await fetchCatalog("q=mcp&from=0&size=40");
  assert.ok(Array.isArray(body.plugins) && body.plugins.length > 0);
  // npm 搜索保持自己的 relevance 顺序（popularity 权重不等于下载量），
  // 但翻页不能重复：每页都必须是不同插件。
  const page2 = await fetchCatalog("q=mcp&from=40&size=40");
  const first = new Set(body.plugins.map((plugin) => plugin.name));
  assert.deepEqual(page2.body.plugins.filter((plugin) => first.has(plugin.name)), []);
});

test("keeps the official pi.dev order on the front page", async () => {
  // 官网排序是权威值：npm 搜索的 popularity 打分与「Most downloads」不一致，
  // 所以默认列表不能直接用 npm 搜索结果排序。
  const { body } = await fetchCatalog("q=&from=0&size=40");
  const names = body.plugins.map((plugin) => plugin.name);
  assert.equal(names[0], "pi-mcp-adapter");
  if (names.includes("pi-subagents")) {
    assert.ok(names.indexOf("pi-subagents") < names.indexOf("pi-web-access"));
  }
  const downloads = body.plugins
    .map((plugin) => plugin.monthlyDownloads)
    .filter((value) => typeof value === "number");
  assert.deepEqual(downloads, [...downloads].sort((a, b) => b - a));
});

test("returns an offline-free fallback page for the default listing", async () => {
  const { body } = await fetchCatalog("q=&from=0&size=40");
  assert.ok(Array.isArray(body.plugins));
  assert.equal(body.plugins.length, 40);
  // 内置快照兜底时必须仍然按使用量倒序。
  const downloads = body.plugins
    .map((plugin) => plugin.monthlyDownloads)
    .filter((value) => typeof value === "number");
  assert.deepEqual(downloads, [...downloads].sort((a, b) => b - a));
});
