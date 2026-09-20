import { networkInterfaces } from "node:os";
import { NextResponse } from "next/server";
import { readDesktopLanAccess, readDesktopLanRuntime } from "@/lib/desktop-access";
import { resolveMobilePairInfo, resolvePairPort } from "@/lib/mobile-pair";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/pair — 桌面端生成二维码所需的地址信息。
 *
 * 只返回局域网地址与状态标记，不含任何凭据。
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const session = searchParams.get("session")?.trim();
  const cwd = searchParams.get("cwd")?.trim();

  const access = readDesktopLanAccess();
  const runtime = readDesktopLanRuntime();

  const info = resolveMobilePairInfo({
    bindHost: process.env.PI_WEB_HOSTNAME ?? "127.0.0.1",
    port: resolvePairPort(req.headers.get("host"), process.env.PI_WEB_PORT),
    passwordRequired: access.password !== null || Boolean(process.env.PI_WEB_PASSWORD),
    desktopShell: Boolean(process.env.PI_WEB_DESKTOP_API_ORIGIN),
    interfaces: networkInterfaces(),
    lanAccess: { enabled: access.enabled, lanPort: runtime.lanPort },
    ...(session ? { session } : {}),
    ...(cwd ? { cwd } : {}),
  });

  return NextResponse.json(info);
}
