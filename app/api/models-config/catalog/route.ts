import { NextResponse } from "next/server";
import {
  flattenSdkBuiltInCatalog,
  loadConfiguredProviders,
  fetchProviderModels,
  mergeCatalogs,
  recommendModelCatalogPreset,
  searchModelCatalog,
  type ModelCatalogEntry,
} from "@/lib/model-catalog";

export const dynamic = "force-dynamic";

interface CatalogCache {
  entries: ModelCatalogEntry[];
  expiresAt: number;
  inFlight?: Promise<ModelCatalogEntry[]>;
}

const CATALOG_TTL_MS = 60 * 60 * 1000;

declare global {
  var __piModelCatalogCache: CatalogCache | undefined;
}

function getCache(): CatalogCache {
  return globalThis.__piModelCatalogCache ??= { entries: [], expiresAt: 0 };
}

/**
 * Build the complete model catalog from two sources:
 * 1. The SDK built-in model directory (~60 providers, no network needed).
 * 2. Live provider APIs for any supplier whose credentials are in auth.json / models.json.
 * Live API entries override or fill gaps in the built-in directory.
 */
async function loadCatalog(): Promise<ModelCatalogEntry[]> {
  const base = await flattenSdkBuiltInCatalog();
  const configs = loadConfiguredProviders();

  const liveResults = await Promise.all(
    configs.map((config) => fetchProviderModels(config)),
  );
  const live = liveResults.flat();

  return mergeCatalogs(base, live);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("q") ?? "").slice(0, 120);
  const provider = (searchParams.get("provider") ?? "").slice(0, 120);
  const baseUrl = (searchParams.get("baseUrl") ?? "").slice(0, 500);
  const parsedLimit = Number.parseInt(searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : 50;

  try {
    const cache = getCache();
    let entries: ModelCatalogEntry[];
    if (cache.entries.length > 0 && cache.expiresAt > Date.now()) {
      entries = cache.entries;
    } else if (cache.inFlight) {
      entries = await cache.inFlight;
    } else {
      cache.inFlight = loadCatalog().then((result) => {
        cache.entries = result;
        cache.expiresAt = Date.now() + CATALOG_TTL_MS;
        return result;
      }).finally(() => {
        cache.inFlight = undefined;
      });
      entries = await cache.inFlight;
    }

    const models = searchModelCatalog(entries, query, provider, limit);
    const recommendation = recommendModelCatalogPreset(entries, query, provider, baseUrl);
    return NextResponse.json({ models, recommendation, source: "sdk-built-in" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
