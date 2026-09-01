import { NextResponse } from "next/server";
import {
  detectDescriptionLanguage,
  translatePluginDescriptions,
  type PluginCatalogEntry,
} from "@/lib/plugin-catalog";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  try {
    const body = await req.json() as {
      plugins?: Array<{ name?: unknown; description?: unknown }>;
      targetLanguage?: unknown;
    };
    const targetLanguage = body.targetLanguage === "en" ? "en" : "zh-CN";
    const plugins = (Array.isArray(body.plugins) ? body.plugins : []).slice(0, 40).flatMap((item) => {
      const name = typeof item.name === "string" ? item.name.trim().slice(0, 214) : "";
      const description = typeof item.description === "string" ? item.description.trim().slice(0, 500) : "";
      if (!name || !description) return [];
      return [{
        name,
        source: `npm:${name}`,
        description,
        descriptionLanguage: detectDescriptionLanguage(description),
        npmUrl: `https://www.npmjs.com/package/${encodeURIComponent(name)}`,
      } satisfies PluginCatalogEntry];
    });
    const translated = await translatePluginDescriptions(plugins, targetLanguage);
    const translations: Record<string, {
      descriptionZh?: string;
      descriptionZhSource?: "curated" | "machine";
      descriptionEn?: string;
      descriptionEnSource?: "machine";
    }> = {};
    for (const plugin of translated) {
      if (targetLanguage === "zh-CN" && plugin.descriptionZh) {
        translations[plugin.name] = {
          descriptionZh: plugin.descriptionZh,
          descriptionZhSource: plugin.descriptionZhSource,
        };
      } else if (targetLanguage === "en" && plugin.descriptionEn) {
        translations[plugin.name] = {
          descriptionEn: plugin.descriptionEn,
          descriptionEnSource: plugin.descriptionEnSource,
        };
      }
    }
    return NextResponse.json({ translations });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
