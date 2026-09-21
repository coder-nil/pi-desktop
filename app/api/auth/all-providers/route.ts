import { createDesktopModelRuntime, refreshDesktopProviderCatalogs } from "@/lib/desktop-providers";
import { buildApiKeyProviderList } from "@/lib/provider-listing";
import { collectProviderListingInputs } from "@/lib/provider-listing-runtime";

export const dynamic = "force-dynamic";

// Providers that accept an API key, including dual-auth ones such as anthropic —
// see lib/provider-listing.ts for why membership is capability-based (#309).
export async function GET() {
  const modelRuntime = await createDesktopModelRuntime();
  // 目录刷新只是补强：模型列表先用本地缓存渲染，绝不阻塞响应。
  // models.dev/api.json 有数 MB，在请求路径里等待它会让设置页的服务商/模型
  // 列表空白数秒（见 lib/models-dev-discovery.ts）。
  void refreshDesktopProviderCatalogs(modelRuntime, AbortSignal.timeout(20_000)).catch(() => {});
  const providers = buildApiKeyProviderList(await collectProviderListingInputs(modelRuntime));
  return Response.json({ providers });
}
