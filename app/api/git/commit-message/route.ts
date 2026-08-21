import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { generateCommitMessage } from "@/lib/commit-message";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { getStagedDiff } from "@/lib/git-manager";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";

async function validateCwd(cwd: unknown): Promise<string> {
  if (typeof cwd !== "string" || !cwd.trim() || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) throw new Error("cwd must be an absolute path");
  const roots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, roots) || !isExistingFilePathAllowed(cwd, roots)) throw new Error("Access denied");
  if (!fs.statSync(cwd).isDirectory()) throw new Error("Not a directory");
  return cwd;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { cwd?: unknown; sessionId?: unknown };
    if (typeof body.sessionId !== "string" || !body.sessionId) throw new Error("A session is required");
    const cwd = await validateCwd(body.cwd);
    const filePath = await resolveSessionPath(body.sessionId);
    if (!filePath) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const existing = getRpcSession(body.sessionId);
    const { session } = existing?.isAlive()
      ? { session: existing }
      : await startRpcSession(body.sessionId, filePath, undefined);
    await session.waitUntilReady?.();
    const message = await generateCommitMessage(session.inner as unknown as AgentSession, await getStagedDiff(cwd));
    return NextResponse.json({ message });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === "Access denied" ? 403 : 400 });
  }
}
