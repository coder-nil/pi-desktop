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

const PI_DEV_SOURCE = "https://pi.dev/packages";

/**
 * 默认列表首次请求只是触发官网热身，本轮仍回退到内置快照；
 * 这里等热身完成再断言官网顺序，官网不可达时跳过而不是误报。
 */
async function fetchOfficialCatalog(t) {
  let result = await fetchCatalog("q=&from=0&size=40");
  for (let attempt = 0; attempt < 6 && result.body.source !== PI_DEV_SOURCE; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    result = await fetchCatalog("q=&from=0&size=40");
  }
  if (result.body.source !== PI_DEV_SOURCE) {
    t.skip("pi.dev catalog unavailable");
    return null;
  }
  return result;
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

test("keeps the official pi.dev order on the front page", async (t) => {
  // 官网排序是权威值：npm 搜索的 popularity 打分与「Most downloads」不一致，
  // 所以默认列表不能直接用 npm 搜索结果排序。
  const result = await fetchOfficialCatalog(t);
  if (!result) return;
  const names = result.body.plugins.map((plugin) => plugin.name);
  // 官网首页是「Most downloads」顺序，热门扩展（pi-mcp-adapter 这类）必须在第一屏。
  assert.ok(names.includes("pi-mcp-adapter"), `got: ${names.slice(0, 10).join(", ")}`);
  const downloads = result.body.plugins
    .map((plugin) => plugin.monthlyDownloads)
    .filter((value) => typeof value === "number");
  assert.deepEqual(downloads, [...downloads].sort((a, b) => b - a));
});

test("searches the whole official catalog instead of the first listing pages", async () => {
  // 官网首页列表只抓得到前 3 页（150 条），pi-playwright 不在其中；
  // 旧实现命中官网缓存后直接切片这 150 条并丢掉关键词，搜索等于失效。
  const { body } = await fetchCatalog("q=playwright&from=0&size=40");
  const names = body.plugins.map((plugin) => plugin.name);
  assert.ok(names.includes("pi-playwright"), `got: ${names.slice(0, 10).join(", ")}`);
});

test("returns an offline-free fallback page for the default listing", async () => {
  // 官网目录没热身好的第一轮请求会回退到内置快照。
  const { body } = await fetchCatalog("q=&from=0&size=40");
  assert.ok(Array.isArray(body.plugins));
  assert.equal(body.plugins.length, 40);
  // 内置快照用实时下载量补完也必须按使用量倒序。
  const downloads = body.plugins
    .map((plugin) => plugin.monthlyDownloads)
    .filter((value) => typeof value === "number");
  assert.deepEqual(downloads, [...downloads].sort((a, b) => b - a));
});
