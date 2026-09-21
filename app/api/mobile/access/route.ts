import { NextResponse } from "next/server";
import {
  MIN_DESKTOP_ACCESS_PASSWORD_LENGTH,
  displayHostname,
  normalizeAccessHostname,
  readDesktopLanAccess,
  readDesktopLanRuntime,
  readDesktopTunnelRuntime,
  validateDesktopAccessPassword,
  writeDesktopLanAccess,
  type DesktopPublicAccess,
} from "@/lib/desktop-access";
import { discoverTunnelHostname } from "@/lib/tunnel-discovery";

export const dynamic = "force-dynamic";

/**
 * GET/PUT /api/mobile/access — 手机访问配置（局域网密码 + 公网入口）。
 *
 * 这里只写配置文件：桌面壳的 Rust 反向代理与隧道管理器会热加载它，所以改密码、
 * 开关公网入口都不需要重启任何进程。
 *
 * 密码会被返回给已经通过认证的界面，因为用户需要在手机上输入它（等同路由器
 * 管理页展示 Wi-Fi 密码）。公网隧道的运行态来自桌面壳单独回写的一份文件。
 */
async function currentState() {
  const access = readDesktopLanAccess();
  const runtime = readDesktopLanRuntime();
  const tunnel = readDesktopTunnelRuntime();
  // 还没配域名时顺手看一眼隧道已经绑的是什么：用登录证书里的 API token 反查 DNS
  // 记录，界面就能直接回填 —— 用户不需要手输自己刚在 Cloudflare 上建的域名。
  const detected = access.public.hostname ? null : await discoverTunnelHostname();
  return {
    enabled: access.enabled,
    password: access.password,
    lanPort: runtime.lanPort,
    public: access.public,
    /** punycode 落盘、Unicode 展示；界面直接用这个字段回填输入框。 */
    publicHostnameDisplay: displayHostname(access.public.hostname),
    /** 自动发现到的域名（同样已经转成 Unicode），仅作为回填/兑底值。 */
    publicHostnameDetected: displayHostname(detected),
    tunnel,
    minPasswordLength: MIN_DESKTOP_ACCESS_PASSWORD_LENGTH,
    // 命令行启动时没有桌面壳的代理/隧道，开关不会生效，界面需要说明。
    desktopShell: Boolean(process.env.PI_WEB_DESKTOP_API_ORIGIN),
  };
}

/** 只接受 bool/string 这类可解释字段，其余一律退回当前值。 */
function mergePublicInput(
  current: DesktopPublicAccess,
  value: unknown,
  fallbackHostname: string | null,
): { ok: true; value: DesktopPublicAccess } | { ok: false; code: string } {
  if (value === undefined || value === null) return { ok: true, value: current };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, code: "invalid-public" };
  }
  const record = value as Record<string, unknown>;
  const mode = record.mode === "named" ? "named" : "quick";
  const rawHostname = typeof record.hostname === "string" ? record.hostname.trim() : "";
  // 没填就用手上有的（已保存的 → 自动发现的）：named 模式因此不需要手输域名。
  const hostname = rawHostname ? normalizeAccessHostname(rawHostname) : fallbackHostname;
  if (rawHostname && hostname === null) {
    return { ok: false, code: "invalid-hostname" };
  }
  const enabled = record.enabled === true;
  if (mode === "named" && enabled && !hostname) {
    return { ok: false, code: "hostname-required" };
  }
  return { ok: true, value: { enabled, mode, hostname } };
}

export async function GET() {
  return NextResponse.json(await currentState());
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const record = (body ?? {}) as Record<string, unknown>;
  if (typeof record.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }

  const current = readDesktopLanAccess();
  let password = current.password;

  if (typeof record.password === "string" && record.password.trim()) {
    const validated = validateDesktopAccessPassword(record.password);
    if (!validated.ok) {
      return NextResponse.json({
        error: `password must be at least ${MIN_DESKTOP_ACCESS_PASSWORD_LENGTH} characters`,
        code: validated.error,
      }, { status: 400 });
    }
    password = validated.value;
  }

  if (record.enabled && password === null) {
    return NextResponse.json({
      error: "a password is required before enabling phone access",
      code: "password-required",
    }, { status: 400 });
  }

  // 公网入口要求先有密码：代理没密码就不监听，隧道只会拿到 502。
  let fallbackHostname = current.public.hostname;
  if (!fallbackHostname) fallbackHostname = await discoverTunnelHostname();
  const merged = mergePublicInput(current.public, record.public, fallbackHostname);
  if (!merged.ok) {
    const messages: Record<string, string> = {
      "invalid-public": "public access settings are malformed",
      "invalid-hostname": "the hostname is not a valid domain",
      "hostname-required": "a hostname is required for the named tunnel mode",
    };
    return NextResponse.json({
      error: messages[merged.code] ?? "invalid public access settings",
      code: merged.code,
    }, { status: 400 });
  }
  if (merged.value.enabled && password === null) {
    return NextResponse.json({
      error: "a password is required before enabling public access",
      code: "password-required",
    }, { status: 400 });
  }

  try {
    writeDesktopLanAccess({ enabled: record.enabled, password, public: merged.value });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }

  return NextResponse.json({ ...(await currentState()), saved: true });
}
