import { NextRequest, NextResponse } from "next/server";
import { createCheckpoint, finalizeCheckpoint, listCheckpoints, restoreCheckpoint } from "@/lib/checkpoint";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "@/lib/file-access";
import fs from "fs";

async function validate(cwd: unknown): Promise<string> {
  if (typeof cwd !== "string" || !cwd.trim()) throw new Error("cwd is required");
  const roots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, roots) || !isExistingFilePathAllowed(cwd, roots) || !fs.statSync(cwd).isDirectory()) throw new Error("Access denied");
  return cwd;
}
function error(e: unknown) { const message = e instanceof Error ? e.message : String(e); return NextResponse.json({ error: message }, { status: message === "Access denied" ? 403 : 400 }); }
export async function GET(req: NextRequest) { try { const sid = req.nextUrl.searchParams.get("sessionId"); if (!sid) throw new Error("sessionId is required"); return NextResponse.json({ checkpoints: await listCheckpoints(sid) }); } catch (e) { return error(e); } }
export async function POST(req: NextRequest) { try {
  const body = await req.json() as { action?: string; sessionId?: string; cwd?: string; checkpointId?: string; entryId?: string };
  if (!body.sessionId) throw new Error("sessionId is required");
  if (body.action === "create") return NextResponse.json(await createCheckpoint(body.sessionId, await validate(body.cwd)));
  if (body.action === "finalize") return NextResponse.json(await finalizeCheckpoint(body.sessionId, body.checkpointId || "", body.entryId));
  if (body.action === "restore") return NextResponse.json(await restoreCheckpoint(body.sessionId, body.checkpointId || ""));
  throw new Error("Unsupported checkpoint action");
} catch (e) { return error(e); } }
