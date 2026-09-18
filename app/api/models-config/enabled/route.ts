import { NextResponse } from "next/server";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createDesktopModelRuntime, refreshDesktopProviderCatalogs } from "@/lib/desktop-providers";
import { invalidateModelsCache } from "@/lib/models-cache";
import { resolveVisibleModels } from "@/lib/model-scope";
import { applyProviderSelection, buildEnabledModelPatterns, modelKey, type EnabledModelRef } from "@/lib/enabled-models";

export const dynamic = "force-dynamic";

/**
 * 「模型选择列表」的白名单接口。
 *
 * 对话框里的模型下拉由 `enabledModels` 决定（见 lib/model-scope.ts），设置页的
 * 服务商详情用它展示可用模型并勾选。读写都走 pi 自己的 SettingsManager，保证
 * 桌面端与 CLI 看到同一份可见列表。
 */

interface ProviderModelsResponse {
  provider: string;
  models: { id: string; name: string; selected: boolean }[];
  /** 当前 `enabledModels` 原始设置；null 表示未设置（全部模型可见）。 */
  enabledModels: string[] | null;
  unscoped: boolean;
  warnings: string[];
  /** 该服务商还没有已知模型：已触发一次后台目录刷新，前端可稍后重试。 */
  refreshing: boolean;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === "string");
}

function createSettings(): SettingsManager {
  return SettingsManager.create(process.cwd(), getAgentDir());
}

function refsWithPins(
  available: readonly { provider: string; id: string }[],
  pins: Record<string, string>,
): EnabledModelRef[] {
  return available.map((model) => {
    const pin = pins[modelKey(model)];
    return pin ? { ...model, thinkingLevel: pin } : { ...model };
  });
}

export async function GET(req: Request) {
  const provider = (new URL(req.url).searchParams.get("provider") ?? "").trim();
  if (!provider) return NextResponse.json({ error: "provider is required" }, { status: 400 });

  try {
    const modelRuntime = await createDesktopModelRuntime();
    const settings = createSettings();
    const patterns = settings.getEnabledModels() ?? null;
    const scope = await resolveVisibleModels(modelRuntime, patterns ?? undefined);
    const available = await modelRuntime.getAvailable();
    const providerModels = available.filter((model) => model.provider === provider);
    const visibleKeys = new Set(scope.visible.map(modelKey));

    const payload: ProviderModelsResponse = {
      provider,
      models: providerModels
        .map((model) => ({ id: model.id, name: model.name, selected: visibleKeys.has(modelKey(model)) }))
        .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
      enabledModels: patterns,
      unscoped: !patterns || patterns.length === 0,
      warnings: scope.warnings,
      refreshing: false,
    };

    // 服务商还没有模型时补一次目录刷新，但不阻塞响应。
    if (providerModels.length === 0) {
      void refreshDesktopProviderCatalogs(modelRuntime, AbortSignal.timeout(20_000)).catch(() => {});
      payload.refreshing = true;
    }

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const record = (body ?? {}) as Record<string, unknown>;
  const provider = typeof record.provider === "string" ? record.provider.trim() : "";
  const modelIds = stringArray(record.modelIds);
  if (!provider) return NextResponse.json({ error: "provider is required" }, { status: 400 });
  if (!modelIds) return NextResponse.json({ error: "modelIds must be an array of strings" }, { status: 400 });

  try {
    const modelRuntime = await createDesktopModelRuntime();
    const settings = createSettings();
    const available = await modelRuntime.getAvailable();
    const providerModels = available.filter((model) => model.provider === provider);
    if (providerModels.length === 0) {
      return NextResponse.json({ error: `No available models for "${provider}"` }, { status: 400 });
    }

    const known = new Set(providerModels.map((model) => model.id));
    const unknown = [...new Set(modelIds)].filter((id) => !known.has(id));
    if (unknown.length > 0) {
      return NextResponse.json({ error: `Unknown models for "${provider}": ${unknown.join(", ")}` }, { status: 400 });
    }

    const patterns = settings.getEnabledModels() ?? null;
    const scope = await resolveVisibleModels(modelRuntime, patterns ?? undefined);
    const selected = applyProviderSelection({
      visible: scope.visible.map((model) => ({ provider: model.provider, id: model.id })),
      provider,
      modelIds,
    });

    const nextPatterns = buildEnabledModelPatterns(
      refsWithPins(available, scope.thinkingLevelPins),
      selected,
    );
    // 空数组不是「全部隐藏」而是「作用域失效」，pi 会回退成全部模型可见。
    if (nextPatterns && nextPatterns.length === 0) {
      return NextResponse.json(
        { error: "At least one model must stay visible in the picker" },
        { status: 400 },
      );
    }

    settings.setEnabledModels(nextPatterns);
    await settings.flush();
    invalidateModelsCache();

    return NextResponse.json({ enabledModels: nextPatterns ?? null, saved: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
