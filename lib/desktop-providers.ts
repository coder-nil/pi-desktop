import { ModelRuntime, type CreateModelRuntimeOptions } from "@earendil-works/pi-coding-agent";
import { parseDiscoveredModels } from "./model-discovery";
import { APISETS_BASE_URL, APISETS_PROVIDER_ID } from "./desktop-provider-constants";
import { responsesTerminalFetch } from "./responses-terminal-fetch";
import type { FetchFunction } from "@earendil-works/pi-ai";

function withResponsesFetch<T extends { fetch?: FetchFunction }>(options: T | undefined): T {
  return { ...options, fetch: responsesTerminalFetch(options?.fetch) } as T;
}

export { APISETS_BASE_URL, APISETS_PROVIDER_ID } from "./desktop-provider-constants";

function apiSetsModels(payload: unknown) {
  return parseDiscoveredModels(payload).map((model) => ({
    id: model.id,
    name: model.name ?? model.id,
    // Coding exposes GPT through Responses, matching Codex's wire protocol.
    // Keep tool results and reasoning in their native format instead of
    // round-tripping them through the provider's Anthropic compatibility layer.
    ...(model.id.startsWith("gpt-") ? { api: "openai-responses" as const } : {}),
    reasoning: true,
    input: ["text", "image"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: model.contextWindow ?? 128_000,
    maxTokens: model.maxTokens ?? 16_384,
    // Coding's GLM 5.3 emits unsigned thinking. Without this compatibility
    // flag, the Messages adapter replays that reasoning as assistant text.
    ...(model.id === "glm-5.3" ? { compat: { allowEmptySignature: true } } : {}),
  }));
}

/** Register providers shipped by Pi Desktop on a runtime instance. */
export function registerDesktopProviders(modelRuntime: ModelRuntime): void {
  if (modelRuntime.getProvider(APISETS_PROVIDER_ID)) return;

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
  return modelRuntime;
}

/** Refresh catalogs that need an API key after their credentials are available. */
export async function refreshDesktopProviderCatalogs(modelRuntime: ModelRuntime, signal?: AbortSignal): Promise<void> {
  await modelRuntime.refresh({
    allowNetwork: true,
    providers: [APISETS_PROVIDER_ID],
    ...(signal ? { signal } : {}),
  });
}
