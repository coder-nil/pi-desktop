import { NextResponse } from "next/server";
import {
  buildSessionContext,
  getSessionEntries,
  listAllSessions,
  resolveSessionPath,
} from "@/lib/session-reader";
import type { SessionInfo } from "@/lib/types";
import type { MobileMessage } from "@/lib/mobile-state";
import { getRpcSession, getRunningRpcSessionIds } from "@/lib/rpc-manager";
import {
  buildMobileWindow,
  MOBILE_DEFAULT_LIMIT,
  MOBILE_DETAIL_WINDOW,
  MOBILE_MAX_LIMIT,
  pickPendingUiRequest,
} from "@/lib/mobile-state";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = MOBILE_DEFAULT_LIMIT;
const MAX_LIMIT = MOBILE_MAX_LIMIT;

/**
 * GET /api/mobile/state — 手机遥控页的一次性快照。
 *
 * 没有指定 `session` 时按「正在运行的会话 → 最近更新的会话」挑选，`cwd`
 * 用于把范围限定在二维码携带的项目里。消息在这里就压成纯文本，手机端
 * 不做 markdown / 高亮。
 *
 * `limit` 是「最新的多少条」，默认 30，上限 300；返回的 `earlierCount` 告诉手机
 * 还有多少条更早的消息，翻历史就是把这个值一批批调大。窗口里最后
 * `MOBILE_DETAIL_WINDOW` 条带思考与工具细节，更早的降成摘要（否则 300 条带细节
 * 的快照接近 500KB，手机每次切回前台重拉一次很不划算）。
 */
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const requestedSession = searchParams.get("session")?.trim() || null;
  const cwd = searchParams.get("cwd")?.trim() || null;
  const parsedLimit = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  try {
    const running = new Set(getRunningRpcSessionIds());
    const sessions = await listAllSessions();
    const picked = requestedSession
      ? sessions.find((session) => session.id === requestedSession) ?? null
      : pickSession(sessions, cwd, running);

    const sessionId = requestedSession ?? picked?.id ?? null;
    if (!sessionId) {
      return NextResponse.json({
        sessionId: null,
        name: null,
        cwd,
        status: "idle",
        updatedAt: null,
        queue: { steering: 0, followUp: 0 },
        pendingUiRequest: null,
        messages: [],
        earlierCount: 0,
      });
    }

    const filePath = await resolveSessionPath(sessionId);
    let messages: MobileMessage[] = [];
    let earlierCount = 0;
    let thinkingLevel: string | undefined;
    let model: { provider: string; modelId: string } | null = null;
    if (filePath) {
      const entries = getSessionEntries(filePath);
      const context = buildSessionContext(entries);
      const window = buildMobileWindow(context.messages, context.entryIds, limit, {
        detailWindow: MOBILE_DETAIL_WINDOW,
      });
      messages = window.messages;
      earlierCount = window.earlierCount;
      thinkingLevel = context.thinkingLevel;
      model = context.model;
    }

    const info = picked ?? sessions.find((session) => session.id === sessionId) ?? null;
    const liveState = await readLiveState(sessionId);
    const queue = {
      steering: liveState?.queuedMessages?.steering?.length ?? 0,
      followUp: liveState?.queuedMessages?.followUp?.length ?? 0,
    };
    const pendingUiRequest = pickPendingUiRequest(liveState);

    return NextResponse.json({
      sessionId,
      name: info?.name ?? null,
      cwd: info?.cwd ?? cwd,
      status: running.has(sessionId) ? "running" : "idle",
      updatedAt: info?.modified ?? null,
      queue,
      pendingUiRequest,
      messages,
      earlierCount,
      ...(thinkingLevel ? { thinkingLevel } : {}),
      ...(model ? { model } : {}),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/** 正在运行的会话优先；否则取最近更新的一条（限定 cwd 时先在项目内找）。 */
function pickSession(
  sessions: readonly SessionInfo[],
  cwd: string | null,
  running: ReadonlySet<string>,
): SessionInfo | null {
  const scoped = cwd ? sessions.filter((session) => session.cwd === cwd) : [];
  const pool = scoped.length > 0 ? scoped : sessions;
  const runningSession = pool.find((session) => running.has(session.id));
  if (runningSession) return runningSession;

  return [...pool].sort((left, right) => right.modified.localeCompare(left.modified))[0] ?? null;
}

interface LiveAgentState {
  queuedMessages?: { steering?: unknown[]; followUp?: unknown[] };
  pendingUiRequests?: unknown[];
}

/** 读一次活会话的内存状态；没有活会话（或读取失败）时安静地当作空。 */
async function readLiveState(sessionId: string): Promise<LiveAgentState | null> {
  const wrapper = getRpcSession(sessionId);
  if (!wrapper?.isAlive()) return null;
  try {
    return await wrapper.send({ type: "get_state" }) as LiveAgentState | null;
  } catch {
    return null;
  }
}
