import { NextResponse } from "next/server";
import {
  loadConfiguredProviders,
  fetchProviderModels,
  mergeCatalogs,
  recommendModelCatalogPreset,
  searchModelCatalog,
  type ModelCatalogEntry,
} from "@/lib/model-catalog";
import { getModelsDevCatalog } from "@/lib/models-dev-discovery";

export const dynamic = "force-dynamic";

interface CatalogCache {
  entries: ModelCatalogEntry[];
  expiresAt: number;
  inFlight?: Promise<{ entries: ModelCatalogEntry[]; source: string }>;
  source?: string;
}

const CATALOG_TTL_MS = 60 * 60 * 1000;

declare global {
  var __piModelCatalogCache: CatalogCache | undefined;
}

function getCache(): CatalogCache {
  return globalThis.__piModelCatalogCache ??= { entries: [], expiresAt: 0, source: "models-dev" };
}

/**
 * Build the catalog from models.dev, then let configured providers override
 * matching records with their live /models responses.
 */
async function loadCatalog(): Promise<{ entries: ModelCatalogEntry[]; source: string }> {
  const configs = loadConfiguredProviders();
  let entries = await getModelsDevCatalog();

  if (configs.length > 0) {
    const liveResults = await Promise.allSettled(
      configs.map((config) => fetchProviderModels(config)),
    );
    const live = liveResults
      .filter((r): r is PromiseFulfilledResult<ModelCatalogEntry[]> => r.status === "fulfilled")
      .flatMap((r) => r.value);

    if (live.length > 0) {
      entries = mergeCatalogs(entries, live);
      return { entries, source: "provider-api" };
    }
  }

  return { entries, source: "models-dev" };
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
    let source: string;
    if (cache.entries.length > 0 && cache.expiresAt > Date.now()) {
      entries = cache.entries;
      source = cache.source ?? "models-dev";
    } else if (cache.inFlight) {
      const result = await cache.inFlight;
      entries = result.entries;
      source = result.source;
    } else {
      cache.inFlight = loadCatalog().then((result) => {
        cache.entries = result.entries;
        cache.expiresAt = Date.now() + CATALOG_TTL_MS;
        cache.source = result.source;
        return result;
      }).finally(() => {
        cache.inFlight = undefined;
      });
      const result = await cache.inFlight;
      entries = result.entries;
      source = result.source;
    }

    const models = searchModelCatalog(entries, query, provider, limit);
    const recommendation = recommendModelCatalogPreset(entries, query, provider, baseUrl);
    return NextResponse.json({ models, recommendation, source });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
