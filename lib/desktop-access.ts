import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * 手机访问（局域网）配置。
 *
 * 这份文件是 Node 侧与桌面壳（Rust 代理）之间的唯一契约：
 *   - 设置页通过 /api/mobile/access 写入；
 *   - Rust 代理每次请求检查文件 mtime，变化即热加载，所以改密码不需要重启任何进程；
 *   - `lanPort` 由 Rust 在代理真正监听成功后回写，Node 侧不再自己猜端口。
 */
export interface DesktopLanAccess {
  enabled: boolean;
  password: string | null;
}

/** 桌面壳回写的运行时状态：代理真正监听的端口。 */
export interface DesktopLanRuntime {
  lanPort: number | null;
}

export const MIN_DESKTOP_ACCESS_PASSWORD_LENGTH = 8;

const EMPTY_ACCESS: DesktopLanAccess = { enabled: false, password: null };
const EMPTY_RUNTIME: DesktopLanRuntime = { lanPort: null };

export function desktopAccessPath(agentDir = getAgentDir()): string {
  return join(agentDir, "desktop-access.json");
}

/**
 * 运行时状态单独存放，避免设置页与代理同时写同一个文件。
 */
export function desktopLanRuntimePath(agentDir = getAgentDir()): string {
  return join(agentDir, "desktop-access.runtime.json");
}

function normalizePort(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) return null;
  return value;
}

function normalizePassword(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 读取配置；文件缺失或损坏时都退回到「未启用」，绝不让坏配置把局域网开出来。 */
export function readDesktopLanAccess(databasePath = desktopAccessPath()): DesktopLanAccess {
  try {
    const parsed = JSON.parse(readFileSync(databasePath, "utf-8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ...EMPTY_ACCESS };
    const record = parsed as Record<string, unknown>;
    const password = normalizePassword(record.password);
    return {
      enabled: record.enabled === true && password !== null,
      password,
    };
  } catch {
    return { ...EMPTY_ACCESS };
  }
}

/** 读取桌面壳回写的监听端口。 */
export function readDesktopLanRuntime(databasePath = desktopLanRuntimePath()): DesktopLanRuntime {
  try {
    const parsed = JSON.parse(readFileSync(databasePath, "utf-8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ...EMPTY_RUNTIME };
    return { lanPort: normalizePort((parsed as Record<string, unknown>).lanPort) };
  } catch {
    return { ...EMPTY_RUNTIME };
  }
}

export function writeDesktopLanAccess(
  access: DesktopLanAccess,
  databasePath = desktopAccessPath(),
): void {
  mkdirSync(dirname(databasePath), { recursive: true });
  const payload: DesktopLanAccess = {
    enabled: access.enabled && access.password !== null,
    password: access.password,
  };
  writeFileSync(databasePath, JSON.stringify(payload, null, 2), { encoding: "utf-8", mode: 0o600 });
  chmodSync(databasePath, 0o600);
}

export type PasswordValidation =
  | { ok: true; value: string }
  | { ok: false; error: "too-short" };

/**
 * 密码规则：非空且至少 8 位。
 *
 * 这是局域网里唯一的一道闸门 —— 拿到它就能指挥本机的 agent，所以不接受弱口令。
 */
export function validateDesktopAccessPassword(password: unknown): PasswordValidation {
  if (typeof password !== "string") return { ok: false, error: "too-short" };
  const trimmed = password.trim();
  if (trimmed.length < MIN_DESKTOP_ACCESS_PASSWORD_LENGTH) return { ok: false, error: "too-short" };
  return { ok: true, value: trimmed };
}
