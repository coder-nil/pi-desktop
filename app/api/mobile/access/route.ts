import { NextResponse } from "next/server";
import {
  MIN_DESKTOP_ACCESS_PASSWORD_LENGTH,
  readDesktopLanAccess,
  readDesktopLanRuntime,
  validateDesktopAccessPassword,
  writeDesktopLanAccess,
} from "@/lib/desktop-access";

export const dynamic = "force-dynamic";

/**
 * GET/PUT /api/mobile/access — 手机访问（局域网）配置。
 *
 * 这里只写配置文件：桌面壳的 Rust 反向代理会热加载它并负责真正的监听与认证，
 * 因此改密码不需要重启任何进程。密码会被返回给已经通过认证的界面，因为用户
 * 需要在手机上输入它（等同路由器管理页展示 Wi-Fi 密码）。
 */
function currentState() {
  const access = readDesktopLanAccess();
  const runtime = readDesktopLanRuntime();
  return {
    enabled: access.enabled,
    password: access.password,
    lanPort: runtime.lanPort,
    minPasswordLength: MIN_DESKTOP_ACCESS_PASSWORD_LENGTH,
    // 命令行启动时没有桌面壳的代理，开关不会生效，界面需要说明。
    desktopShell: Boolean(process.env.PI_WEB_DESKTOP_API_ORIGIN),
  };
}

export async function GET() {
  return NextResponse.json(currentState());
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

  try {
    writeDesktopLanAccess({ enabled: record.enabled, password });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }

  return NextResponse.json({ ...currentState(), saved: true });
}
