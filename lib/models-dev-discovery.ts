import {
  flattenModelsDevCatalog,
  type ModelCatalogEntry,
} from "./model-catalog";

const MODELS_DEV_API = "https://models.dev/api.json";
const MODELS_DEV_MODELS = "https://models.dev/models.json";
const MODELS_DEV_TIMEOUT_MS = 15_000;
const MODELS_DEV_CACHE_TTL_MS = 30 * 60 * 1000;

interface ModelsDevCache {
  entries: ModelCatalogEntry[];
  expiresAt: number;
}

declare global {
  var __piModelsDevCatalogCache: ModelsDevCache | undefined;
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(MODELS_DEV_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function fetchCatalog(url: string, signal?: AbortSignal): Promise<ModelCatalogEntry[]> {
  const response = await fetch(url, { signal: requestSignal(signal) });
  if (!response.ok) throw new Error(`models.dev returned HTTP ${response.status}`);
  const entries = flattenModelsDevCatalog(await response.json());
  if (entries.length === 0) throw new Error("models.dev returned an empty model catalog");
  return entries;
}

/** Load the public models.dev catalog, preferring its provider-grouped API. */
export async function fetchModelsDevCatalog(
  options: { signal?: AbortSignal; force?: boolean } = {},
): Promise<ModelCatalogEntry[]> {
  const now = Date.now();
  const cached = globalThis.__piModelsDevCatalogCache;
  if (!options.force && cached && cached.expiresAt > now) return cached.entries;

  const errors: unknown[] = [];
  try {
    const entries = await fetchCatalog(MODELS_DEV_API, options.signal);
    globalThis.__piModelsDevCatalogCache = { entries, expiresAt: now + MODELS_DEV_CACHE_TTL_MS };
    return entries;
  } catch (error) {
    errors.push(error);
  }

  if (options.signal?.aborted) throw options.signal.reason;

  try {
    const entries = await fetchCatalog(MODELS_DEV_MODELS, options.signal);
    globalThis.__piModelsDevCatalogCache = { entries, expiresAt: now + MODELS_DEV_CACHE_TTL_MS };
    return entries;
  } catch (error) {
    errors.push(error);
    throw new AggregateError(errors, "Unable to load the models.dev model catalog");
  }
}
