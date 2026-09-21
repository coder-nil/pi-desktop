import { networkInterfaces } from "node:os";
import { NextResponse } from "next/server";
import {
  displayHostname,
  readDesktopLanAccess,
  readDesktopLanRuntime,
  readDesktopTunnelRuntime,
} from "@/lib/desktop-access";
import { buildMobileUrl, resolveMobilePairInfo, resolvePairPort } from "@/lib/mobile-pair";

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
  const tunnel = readDesktopTunnelRuntime();

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

  // 隧道在跑时把公网地址一并给出去：配对弹窗可以同时给出局域网/公网两种入口。
  // quick 模式每次重启都会换域名，所以这个地址必须实时推导、不能缓存；
  // named 模式没有日志可抓（域名是配置里给的），用 hostname 推出来。
  //
  // 这里刻意用 **Unicode** 形式（π.works）：punycode 只是传输格式（DNS、Host 头、
  // TLS SNI、cloudflared 的 ingress 匹配都必须是它），给人看和扫码的地址不该带
  // xn-- 前缀 —— 浏览器打开时自己会转回去。落盘与生成配置里仍是 punycode。
  const publicBase = tunnel.url
    ?? (tunnel.state === "running" && tunnel.hostname
      ? `https://${displayHostname(tunnel.hostname) ?? tunnel.hostname}`
      : null);
  const publicUrl = publicBase
    ? buildMobileUrl(publicBase, {
        ...(session ? { session } : {}),
        ...(cwd ? { cwd } : {}),
      })
    : null;

  return NextResponse.json({ ...info, publicUrl, publicState: tunnel.state });
}
