import { NextResponse } from "next/server";
import {
  applyPluginDownloads,
  collectPluginDownloads,
  mergeCatalogEntries,
  parsePiDevCatalog,
  parsePluginCatalog,
  searchPluginCatalog,
  sortPluginCatalog,
  type PluginCatalogEntry,
  type RegistrySearchResponse,
} from "@/lib/plugin-catalog";
import { readPluginDownloads, writePluginDownloads } from "@/lib/plugin-downloads-store";

import bundledCatalog from "@/data/plugin-catalog.json";

export const dynamic = "force-dynamic";

const NPM_SEARCH_URL = "https://registry.npmjs.org/-/v1/search";
const PI_DEV_CATALOG_URL = "https://pi.dev/packages";
const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_SIZE = 40;
const MAX_SIZE = 100;
const MAX_FROM = 1_000;
const BUNDLED_SOURCE = "bundled:plugin-catalog.json";

/**
 * 官网首页列表每页 50 条，只抓前 3 页（150 条）；官网实际有 100 多页几千个包，
 * 所以关键词搜索必须走官网自己的 `?name=` 搜索，不能在这 150 条里过滤。
 */
const PI_DEV_PAGES = ["", "?page=2", "?page=3"];
const PI_DEV_CATALOG_KEY = "__pi_dev_catalog";
const PI_DEV_FAILURE_TTL_MS = 60 * 1000;

type CatalogValue = { plugins: PluginCatalogEntry[]; total: number; source?: string };

interface CatalogCacheEntry {
  expiresAt: number;
  value: CatalogValue;
}

interface CatalogCacheState {
  entries: Map<string, CatalogCacheEntry>;
  inFlight: Map<string, Promise<unknown>>;
}

declare global {
  var __piPluginCatalogCache: CatalogCacheState | undefined;
}

function getCache(): CatalogCacheState {
  return globalThis.__piPluginCatalogCache ??= { entries: new Map(), inFlight: new Map() };
}

function readBoundedInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

/** npm registry 搜索：搜索词元数据（描述/作者/仓库）与按小写名称建立索引。 */
async function fetchRegistryCatalog(query: string, from: number, size: number): Promise<{
  plugins: ReturnType<typeof sortPluginCatalog>;
  total: number;
}> {
  const url = new URL(NPM_SEARCH_URL);
  url.searchParams.set("text", `keywords:pi-package${query ? ` ${query}` : ""}`);
  url.searchParams.set("from", String(from));
  url.searchParams.set("size", String(size));
  url.searchParams.set("quality", "0.65");
  url.searchParams.set("popularity", "0.98");
  url.searchParams.set("maintenance", "0.5");
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`);
  const payload = await response.json() as RegistrySearchResponse;
  return {
    plugins: parsePluginCatalog(payload),
    total: typeof payload.total === "number" && Number.isFinite(payload.total) ? payload.total : 0,
  };
}

/** 官网顺序就是权威排序，这里只做切片。 */
function pageOf(plugins: PluginCatalogEntry[], from: number, size: number): PluginCatalogEntry[] {
  return plugins.slice(from, from + size);
}

/**
 * 官网搜索页：`${PI_DEV_CATALOG_URL}?name=<query>` 是站点自己的搜索（就是首页搜索框），
 * 覆盖全部官网目录；搜索结果页不分页，一次给 30 条。
 */
async function fetchPiDevSearch(query: string): Promise<PluginCatalogEntry[]> {
  const url = new URL(PI_DEV_CATALOG_URL);
  url.searchParams.set("name", query);
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "text/html", "User-Agent": "pi-desktop" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`pi.dev returned HTTP ${response.status}`);
  return parsePiDevCatalog(await response.text());
}

/**
 * 关键词目录：官网搜索（权威排序 + 全目录覆盖）为主，npm 搜索补齐描述/作者与更深的分页。
 *
 * 两边都失败才抛错，由 GET 回退到内置快照；两边都成功但没命中时返回空列表，
 * 让前端显示「没有匹配的插件」而不是把关键词悄悄忽略掉。
 */
async function fetchSearchCatalog(query: string): Promise<CatalogValue> {
  const [official, registry] = await Promise.allSettled([
    fetchPiDevSearch(query),
    fetchRegistryCatalog(query, 0, MAX_SIZE),
  ]);
  if (official.status === "rejected" && registry.status === "rejected") {
    const reason = registry.reason instanceof Error ? registry.reason.message : String(registry.reason);
    throw new Error(`plugin search failed: ${reason}`);
  }
  const primary = official.status === "fulfilled" ? official.value : [];
  const metadata = registry.status === "fulfilled"
    ? applyPluginDownloads(registry.value.plugins, readPluginDownloads())
    : [];

  // 官网搜索页的召回顺序就是权威排序（匹配集合内按使用量），不能拿 npm 的模糊召回重排：
  // npm 会为 `keywords:pi-package playwright` 召回一堆描述里蹭到关键词的大包，
  // 按下载量重排会把 pi-playwright 这种下载量小的包直接挤到第一页之外。
  const merged = mergeCatalogEntries(primary, metadata);
  const seen = new Set(merged.map((entry) => entry.name));
  // npm 搜索是模糊召回，补进来的包必须自己也能匹配关键词，否则整页都是无关插件；
  // 官网搜索不可用时没有权威召回，只能整取 npm 结果（按使用量排）。
  const extras = primary.length > 0
    ? sortPluginCatalog(searchPluginCatalog(metadata, query)).filter((entry) => !seen.has(entry.name))
    : sortPluginCatalog(metadata.filter((entry) => !seen.has(entry.name)));

  const plugins = [...merged, ...extras];
  return {
    plugins,
    total: plugins.length,
    source: `${PI_DEV_CATALOG_URL}?name=${encodeURIComponent(query)}`,
  };
}

function bundledPage(query: string, from: number, size: number) {
  const downloads = readPluginDownloads();
  // 内置快照里的旧使用量是快照值，只用实时下载量补，不用它覆盖；
  // 覆盖后必须重新排一次，否则拿实时下载量补完却沿用快照顺序。
  const all = sortPluginCatalog(applyPluginDownloads(searchPluginCatalog(bundledCatalog as PluginCatalogEntry[], query), downloads));
  return {
    plugins: all.slice(from, from + size),
    total: all.length,
    source: BUNDLED_SOURCE,
  };
}

/**
 * 整表按关键词缓存：官网搜索 + npm 搜索合并后只排一次序，翻页直接切片，
 * 顺序不会因为两次请求的排序差异而漂移（旧实现按 from/size 缓存，翻页要靠 npm 的 offset）。
 */
async function loadSearchCatalog(query: string): Promise<CatalogValue> {
  const key = `search\0${query}`;
  const cache = getCache();
  const cached = cache.entries.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const existing = cache.inFlight.get(key);
  if (existing) return existing as Promise<CatalogValue>;
  const promise = fetchSearchCatalog(query).then((value) => {
    cache.entries.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }).finally(() => {
    cache.inFlight.delete(key);
  });
  cache.inFlight.set(key, promise);
  return promise;
}

interface PiDevCatalogValue {
  plugins: PluginCatalogEntry[];
  total: number;
  source: string;
}

async function fetchPiDevPage(page: string): Promise<PluginCatalogEntry[]> {
  const response = await fetch(`${PI_DEV_CATALOG_URL}${page}`, {
    cache: "no-store",
    headers: { Accept: "text/html", "User-Agent": "pi-desktop" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`pi.dev returned HTTP ${response.status}`);
  return parsePiDevCatalog(await response.text());
}

/**
 * 官网目录（权威排序源）+ npm 搜索元数据。
 *
 * 拿官网名单当主列表（它已经按使用量排好），用 npm 搜索结果补齐描述/作者等字段；
 * 两边都失败时由调用方回退到内置目录。
 */
async function loadPiDevCatalog(): Promise<PiDevCatalogValue> {
  const pages = await Promise.all(PI_DEV_PAGES.map(fetchPiDevPage));
  const primary: PluginCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    for (const entry of page) {
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      primary.push(entry);
    }
  }
  if (primary.length === 0) throw new Error("pi.dev catalog returned no packages");

  const registry = await fetchRegistryCatalog("", 0, MAX_SIZE);
  const merged = mergeCatalogEntries(primary, registry.plugins);
  const { monthly, weekly } = collectPluginDownloads(primary);
  writePluginDownloads({ monthly, weekly });
  // 合并后再整体排一次：官网和 npm 对同一包给的使用量可能不一致，
  // 排序依据统一取“两边取大”，避免出现「下载量更大却排在后面」。
  return {
    plugins: sortPluginCatalog(merged),
    total: primary.length,
    source: PI_DEV_CATALOG_URL,
  };
}

function getPiDevCache(): CatalogCacheEntry | null {
  const entry = getCache().entries.get(PI_DEV_CATALOG_KEY);
  return entry && entry.expiresAt > Date.now() ? entry : null;
}

/** 在已缓存的官网名单里过滤（官网只给前 3 页，够默认列表和少量搜索用）。 */
function searchPiDevCatalog(query: string, from: number, size: number) {
  const cached = getPiDevCache();
  if (!cached) return null;
  const needle = query.toLowerCase();
  const terms = needle.split(/\s+/).filter(Boolean);
  const matched = terms.length === 0
    ? cached.value.plugins
    : cached.value.plugins.filter((plugin) => terms.every((term) =>
      `${plugin.name} ${plugin.description} ${plugin.descriptionZh ?? ""} ${plugin.descriptionEn ?? ""}`.toLowerCase().includes(term)));
  return { plugins: matched.slice(from, from + size), total: matched.length };
}

function warmPiDevCatalog(): void {
  const cache = getCache();
  if (cache.entries.has(PI_DEV_CATALOG_KEY) || cache.inFlight.has(PI_DEV_CATALOG_KEY)) return;
  const promise = loadPiDevCatalog().then((value) => {
    cache.entries.set(PI_DEV_CATALOG_KEY, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }).catch(() => {
    // 官网不可用：下一轮请求重试，本次静默回退到内置目录。
    cache.entries.set(PI_DEV_CATALOG_KEY, {
      value: { plugins: [], total: 0, source: PI_DEV_CATALOG_URL },
      expiresAt: Date.now() + PI_DEV_FAILURE_TTL_MS,
    });
    return null;
  }).finally(() => {
    cache.inFlight.delete(PI_DEV_CATALOG_KEY);
  });
  cache.inFlight.set(PI_DEV_CATALOG_KEY, promise);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("q") ?? "").trim().slice(0, 80);
  const from = readBoundedInt(searchParams.get("from"), 0, 0, MAX_FROM);
  const size = readBoundedInt(searchParams.get("size"), DEFAULT_SIZE, 1, MAX_SIZE);
  try {
    if (!query) {
      // 官网目录有缓存就直接用它（含分页），否则发起拉取并在本轮回退到内置快照。
      const official = searchPiDevCatalog(query, from, size);
      if (official) {
        return NextResponse.json({
          ...official,
          from,
          size,
          hasMore: from + size < official.total,
          source: PI_DEV_CATALOG_URL,
        });
      }
      warmPiDevCatalog();
      const result = bundledPage(query, from, size);
      return NextResponse.json({
        ...result,
        from,
        size,
        hasMore: from + size < result.total,
      });
    }
    const catalog = await loadSearchCatalog(query);
    const page = pageOf(catalog.plugins, from, size);
    return NextResponse.json({
      plugins: page,
      total: catalog.total,
      from,
      size,
      hasMore: from + page.length < catalog.total,
      source: catalog.source,
    });
  } catch (error) {
    const fallback = bundledPage(query, from, size);
    if (fallback.plugins.length > 0) {
      return NextResponse.json({
        ...fallback,
        from,
        size,
        hasMore: from + size < fallback.total,
        offline: true,
      });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
