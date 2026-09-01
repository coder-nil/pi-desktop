import { NextResponse } from "next/server";
import {
  parsePluginCatalog,
  getBundledPluginCatalog,
  searchPluginCatalog,
  sortPluginCatalog,
  type RegistrySearchResponse,
} from "@/lib/plugin-catalog";

export const dynamic = "force-dynamic";

const NPM_SEARCH_URL = "https://registry.npmjs.org/-/v1/search";
const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_SIZE = 40;
const MAX_SIZE = 100;
const MAX_FROM = 1_000;
const BUNDLED_SOURCE = "bundled:plugin-catalog.json";

interface CatalogCacheEntry {
  expiresAt: number;
  value: { plugins: ReturnType<typeof sortPluginCatalog>; total: number };
}

interface CatalogCacheState {
  entries: Map<string, CatalogCacheEntry>;
  inFlight: Map<string, Promise<CatalogCacheEntry["value"]>>;
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

async function fetchCatalog(query: string, from: number, size: number) {
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
  const plugins = sortPluginCatalog(parsePluginCatalog(payload));
  return {
    plugins,
    total: typeof payload.total === "number" && Number.isFinite(payload.total) ? payload.total : 0,
  };
}

function bundledPage(query: string, from: number, size: number) {
  const all = searchPluginCatalog(getBundledPluginCatalog(), query);
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
  if (existing) return existing;
  const promise = fetchCatalog(query, from, size).then((value) => {
    cache.entries.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }).finally(() => {
    cache.inFlight.delete(key);
  });
  cache.inFlight.set(key, promise);
  return promise;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("q") ?? "").trim().slice(0, 80);
  const from = readBoundedInt(searchParams.get("from"), 0, 0, MAX_FROM);
  const size = readBoundedInt(searchParams.get("size"), DEFAULT_SIZE, 1, MAX_SIZE);
  try {
    if (!query) {
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
      hasMore: from + size < result.total,
      source: NPM_SEARCH_URL,
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
