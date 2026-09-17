import {
  ModelRuntime,
  type CreateModelRuntimeOptions,
} from "@earendil-works/pi-coding-agent";
import { parseDiscoveredModels } from "./model-discovery";
import { APISETS_BASE_URL, APISETS_PROVIDER_ID } from "./desktop-provider-constants";
import { fetchModelsDevCatalog } from "./models-dev-discovery";
import type { ModelCatalogEntry } from "./model-catalog";
import { responsesTerminalFetch } from "./responses-terminal-fetch";
import type { Api, FetchFunction, Model, Provider } from "@earendil-works/pi-ai";

function withResponsesFetch<T extends { fetch?: FetchFunction }>(options: T | undefined): T {
  return { ...options, fetch: responsesTerminalFetch(options?.fetch) } as T;
}

export { APISETS_BASE_URL, APISETS_PROVIDER_ID } from "./desktop-provider-constants";

const DEEPSEEK_PROVIDER_ID = "deepseek";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

function modelsDevDeepSeekModels(
  entries: readonly ModelCatalogEntry[],
  defaults: readonly Model<Api>[],
): Model<Api>[] {
  const providerEntries = entries.filter((entry) => entry.providerId.toLowerCase() === DEEPSEEK_PROVIDER_ID);
  const reasoningDefault = defaults.find((model) => model.reasoning) ?? defaults[0];

  return providerEntries.map((entry) => {
    const exactDefault = defaults.find((model) => model.id === entry.id);
    const compatibilityDefault = exactDefault ?? reasoningDefault;
    const input = (entry.input ?? ["text"])
      .filter((modality): modality is "text" | "image" => modality === "text" || modality === "image");

    return {
      id: entry.id,
      name: entry.name,
      api: "openai-completions",
      provider: DEEPSEEK_PROVIDER_ID,
      baseUrl: DEEPSEEK_BASE_URL,
      headers: undefined,
      reasoning: entry.reasoning ?? false,
      input: input.length > 0 ? input : ["text"],
      cost: {
        input: entry.cost.input ?? 0,
        output: entry.cost.output ?? 0,
        cacheRead: entry.cost.cacheRead ?? 0,
        cacheWrite: entry.cost.cacheWrite ?? 0,
      },
      contextWindow: entry.contextWindow ?? 128_000,
      maxTokens: entry.maxTokens ?? 16_384,
      ...(compatibilityDefault?.compat ? { compat: compatibilityDefault.compat } : {}),
      ...(entry.reasoning && compatibilityDefault?.thinkingLevelMap
        ? { thinkingLevelMap: compatibilityDefault.thinkingLevelMap }
        : {}),
    };
  });
}

function modelsDevDeepSeekProvider(base: Provider<Api>): Provider<Api> {
  let models = [...base.getModels()];

  return {
    ...base,
    baseUrl: DEEPSEEK_BASE_URL,
    getModels: () => models,
    async refreshModels(context) {
      if (!context.allowNetwork) {
        if (context.stored?.etag === "models.dev") {
          const stored = context.stored.models.filter((model) => model.provider === DEEPSEEK_PROVIDER_ID);
          await context.publish({ update: () => { models = [...stored]; } });
        }
        return;
      }

      const refreshed = modelsDevDeepSeekModels(
        await fetchModelsDevCatalog({ signal: context.signal, force: context.force }),
        models,
      );
      if (refreshed.length === 0) {
        throw new Error("models.dev did not return any DeepSeek models");
      }
      await context.publish({
        persist: { models: refreshed, checkedAt: Date.now(), etag: "models.dev" },
        update: () => { models = refreshed; },
      });
    },
  };
}

function apiSetsModels(payload: unknown) {
  return parseDiscoveredModels(payload).map((model) => ({
    id: model.id,
    name: model.name ?? model.id,
    // Coding exposes GPT through Responses, matching Codex's wire protocol.
    ...(model.id.startsWith("gpt-") ? { api: "openai-responses" as const } : {}),
    reasoning: true,
    input: ["text", "image"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: model.contextWindow ?? 128_000,
    maxTokens: model.maxTokens ?? 16_384,
    ...(model.id === "glm-5.3" ? { compat: { allowEmptySignature: true } } : {}),
  }));
}

/** Register providers shipped by Pi Desktop on a runtime instance. */
export function registerDesktopProviders(modelRuntime: ModelRuntime): void {
  if (!modelRuntime.getProvider(APISETS_PROVIDER_ID)) {
    modelRuntime.registerProvider(APISETS_PROVIDER_ID, {
      name: "Coding",
      baseUrl: APISETS_BASE_URL,
      api: "anthropic-messages",
      authHeader: true,
      async refreshModels(context) {
        if (context.credential?.type !== "api_key" || !context.credential.key) return [];

        const response = await fetch(`${APISETS_BASE_URL}/v1/models`, {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${context.credential.key}`,
          },
          signal: context.signal,
        });
        if (!response.ok) throw new Error(`APIsets model catalog returned HTTP ${response.status}`);
        return apiSetsModels(await response.json());
      },
    });
  }

  const deepSeekProvider = modelRuntime.getProvider(DEEPSEEK_PROVIDER_ID);
  if (deepSeekProvider) modelRuntime.registerNativeProvider(modelsDevDeepSeekProvider(deepSeekProvider));
}

/** Create a standalone runtime with Pi Desktop's built-in providers registered. */
export async function createDesktopModelRuntime(options?: CreateModelRuntimeOptions): Promise<ModelRuntime> {
  const modelRuntime = await ModelRuntime.create(options);
  const stream = modelRuntime.stream.bind(modelRuntime);
  const streamSimple = modelRuntime.streamSimple.bind(modelRuntime);
  modelRuntime.stream = (model, context, requestOptions) => stream(model, context,
    model.api === "openai-responses"
      ? withResponsesFetch(requestOptions)
      : requestOptions);
  modelRuntime.streamSimple = (model, context, requestOptions) => streamSimple(model, context,
    model.api === "openai-responses"
      ? withResponsesFetch(requestOptions)
      : requestOptions);
  registerDesktopProviders(modelRuntime);
  // registerNativeProvider schedules a cache-only refresh. Await our scoped
  // refresh so a caller's immediate network refresh cannot race that task.
  await modelRuntime.refresh({ allowNetwork: false, providers: [DEEPSEEK_PROVIDER_ID] });
  return modelRuntime;
}

/** Refresh the application-owned model catalogs. */
export async function refreshDesktopProviderCatalogs(modelRuntime: ModelRuntime, signal?: AbortSignal): Promise<void> {
  await modelRuntime.refresh({
    allowNetwork: true,
    providers: [APISETS_PROVIDER_ID, DEEPSEEK_PROVIDER_ID],
    ...(signal ? { signal } : {}),
  });
}
