import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveSessionPath, buildSessionContext } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import {
  SESSION_PAGE_SIZE,
  clampSessionPageSize,
  earlierContextWindow,
  tailContextWindow,
} from "@/lib/session-paging";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const leafId = url.searchParams.get("leafId") ?? undefined;
  const deferThinking = url.searchParams.has("deferThinking");
  const deferToolResultImages = url.searchParams.has("deferMedia");
  // `before` = the oldest entry id the client already holds. Its page is the
  // one above that window; without it the newest tail page is returned.
  const beforeEntryId = url.searchParams.get("before");
  const pageSize = clampSessionPageSize(url.searchParams.get("limit"), SESSION_PAGE_SIZE);

  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const filePath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sm = liveRpc?.inner.sessionManager ?? SessionManager.open(filePath!);
    const context = buildSessionContext(sm.getEntries() as never, leafId, {
      deferThinking,
      deferToolResultImages,
    });
    const window = beforeEntryId
      ? earlierContextWindow(context, beforeEntryId, pageSize)
      : tailContextWindow(context, pageSize);

    return NextResponse.json({
      context: { ...context, messages: window.messages, entryIds: window.entryIds },
      paging: {
        hasEarlier: window.hasEarlier,
        totalMessages: window.totalMessages,
        startIndex: window.startIndex,
        pageSize,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
