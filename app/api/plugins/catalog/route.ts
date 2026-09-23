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

/** 官网目录每页 50 条；两者都拿不到时再退回内置快照。 */
const PI_DEV_PAGES = ["", "?page=2", "?page=3"];
const PI_DEV_CATALOG_KEY = "__pi_dev_catalog";
const PI_DEV_FAILURE_TTL_MS = 60 * 1000;

interface CatalogCacheEntry {
  expiresAt: number;
  value: { plugins: ReturnType<typeof sortPluginCatalog>; total: number; source?: string };
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
function pageOf(plugins: PluginCatalogEntry[], from: number, size: number) {
  return {
    plugins: plugins.slice(from, from + size),
    total: plugins.length,
  };
}

/**
 * 目录页：官网名单（权威排序）优先，缺页才补 npm 搜索结果。
 *
 * 注意 offset 必须回传给 registry：npm 搜索的结果顺序与官网不同，
 * 只取第 1 页再自己切片，翻页会原地跳回同一批插件。
 */
async function fetchCatalogPage(query: string, from: number, size: number) {
  const official = getPiDevCache();
  if (official && official.value.plugins.length > 0) {
    const page = pageOf(official.value.plugins, from, size);
    if (page.plugins.length === size || page.plugins.length === official.value.plugins.length) {
      return { ...page, source: PI_DEV_CATALOG_URL };
    }
  }

  const registry = await fetchRegistryCatalog(query, from, size);
  return {
    plugins: applyPluginDownloads(registry.plugins, readPluginDownloads()),
    total: registry.total,
    source: NPM_SEARCH_URL,
  };
}

function bundledPage(query: string, from: number, size: number) {
  const downloads = readPluginDownloads();
  // 内置快照里的旧使用量是快照值，只用实时下载量补，不用它覆盖。
  const all = applyPluginDownloads(searchPluginCatalog(bundledCatalog as PluginCatalogEntry[], query), downloads);
  return {
    plugins: all.slice(from, from + size),
    total: all.length,
    source: BUNDLED_SOURCE,
  };
}

async function loadCatalog(query: string, from: number, size: number) {
  const key = `${query}\0${from}\0${size}`;
  const cache = getCache();
  const cached = cache.entries.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const existing = cache.inFlight.get(key);
  if (existing) return existing as Promise<CatalogCacheEntry["value"]>;
  const promise = fetchCatalogPage(query, from, size).then((value) => {
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
    const result = await loadCatalog(query, from, size);
    return NextResponse.json({
      ...result,
      from,
      size,
      hasMore: from + result.plugins.length < result.total,
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
