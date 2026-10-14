import { NextResponse } from "next/server";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import {
  removeModelFromEnabledModels,
  removeProviderFromEnabledModels,
} from "@/lib/enabled-models";
import { join } from "node:path";
import { invalidateModelsCache } from "@/lib/models-cache";
import { ensureSettingsSchemaFile } from "@/lib/settings-schema";
import { readModelsConfig, writeModelsConfig } from "@/lib/models-config-store";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function removeProviderFromConfig(
  config: Record<string, unknown>,
  providerName: string,
): Record<string, unknown> {
  const providers = isRecord(config.providers) ? { ...config.providers } : {};
  delete providers[providerName];
  return { ...config, providers };
}

function removeModelFromConfig(
  config: Record<string, unknown>,
  providerName: string,
  modelId: string,
): Record<string, unknown> {
  const providers = isRecord(config.providers) ? { ...config.providers } : {};
  const provider = providers[providerName];
  if (!isRecord(provider) || !Array.isArray(provider.models)) return config;

  const models = provider.models.filter((model) => (
    !isRecord(model) || model.id !== modelId
  ));
  const nextProvider: Record<string, unknown> = { ...provider, models };

  if (isRecord(provider.modelOverrides) && provider.modelOverrides[modelId] !== undefined) {
    const modelOverrides = { ...provider.modelOverrides };
    delete modelOverrides[modelId];
    if (Object.keys(modelOverrides).length > 0) nextProvider.modelOverrides = modelOverrides;
    else delete nextProvider.modelOverrides;
  }

  providers[providerName] = nextProvider;
  return { ...config, providers };
}

function providerModelCount(config: Record<string, unknown>, providerName: string): number {
  const providers = isRecord(config.providers) ? config.providers : undefined;
  const provider = providers?.[providerName];
  if (!isRecord(provider) || !Array.isArray(provider.models)) return 0;
  return provider.models.length;
}

async function removeFromEnabledModels(input: {
  provider: string;
  modelId?: string;
  providerRemoved: boolean;
}): Promise<void> {
  const settings = SettingsManager.create(process.cwd(), getAgentDir());
  const patterns = settings.getEnabledModels();
  if (!patterns || patterns.length === 0) return;

  const nextPatterns = input.providerRemoved
    ? removeProviderFromEnabledModels(patterns, input.provider)
    : input.modelId
      ? removeModelFromEnabledModels(patterns, input.provider, input.modelId)
      : patterns;

  if (nextPatterns.length === patterns.length) return;
  // pi treats an empty scope as invalid and falls back to all models, so use
  // undefined to restore the normal unscoped state when nothing remains.
  settings.setEnabledModels(nextPatterns.length > 0 ? nextPatterns : undefined);
  await settings.flush();
  ensureSettingsSchemaFile(join(getAgentDir(), "settings.json"));
  invalidateModelsCache();
}

export async function GET() {
  return NextResponse.json(readModelsConfig());
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    writeModelsConfig(body);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/**
 * Delete one custom provider or model and immediately persist the result.
 * `enabledModels` is cleaned in the same request so deleting a provider cannot
 * leave a stale `provider/*` pattern behind and trigger a scope warning.
 */
export async function DELETE(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const kind = body.kind;
    const provider = typeof body.provider === "string" ? body.provider.trim() : "";
    const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";

    if ((kind !== "provider" && kind !== "model") || !provider) {
      return NextResponse.json({ error: "kind and provider are required" }, { status: 400 });
    }
    if (kind === "model" && !modelId) {
      return NextResponse.json({ error: "modelId is required" }, { status: 400 });
    }

    const current = readModelsConfig();
    const next = kind === "provider"
      ? removeProviderFromConfig(current, provider)
      : removeModelFromConfig(current, provider, modelId);
    writeModelsConfig(next);

    const providerRemoved = kind === "provider" || providerModelCount(next, provider) === 0;
    await removeFromEnabledModels({
      provider,
      ...(kind === "model" ? { modelId } : {}),
      providerRemoved,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
