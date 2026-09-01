import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { getGitSummary, runGitAction, type GitAction } from "@/lib/git-manager";

async function validateCwd(cwd: unknown): Promise<{ cwd: string; roots: Set<string> }> {
  if (typeof cwd !== "string" || !cwd.trim() || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) throw new Error("cwd must be an absolute path");
  const roots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, roots) || !isExistingFilePathAllowed(cwd, roots)) throw new Error("Access denied");
  if (!fs.statSync(cwd).isDirectory()) throw new Error("Not a directory");
  return { cwd, roots };
}

export async function GET(request: NextRequest) {
  try {
    const { cwd } = await validateCwd(request.nextUrl.searchParams.get("cwd"));
    return NextResponse.json(await getGitSummary(cwd));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === "Access denied" ? 403 : 400 });
  }
}

const ACTIONS = new Set<GitAction>(["stage", "unstage", "discard", "commit", "fetch", "pull", "push", "merge", "continue", "abort", "create_branch", "rename_branch", "delete_branch", "checkout_remote_branch", "delete_remote_branch", "pull_branch", "push_branch", "merge_branch"]);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { cwd?: unknown; action?: unknown; paths?: unknown; message?: unknown; rebase?: unknown; branch?: unknown; newBranch?: unknown; startPoint?: unknown; targetBranch?: unknown; credential?: unknown; rememberCredential?: unknown };
    if (typeof body.action !== "string" || !ACTIONS.has(body.action as GitAction)) throw new Error("Unsupported Git action");
    const { cwd, roots } = await validateCwd(body.cwd);
    if (Array.isArray(body.paths) && body.paths.some((filePath) => typeof filePath !== "string" || !isFilePathAllowed(filePath, roots))) {
      throw new Error("Access denied");
    }
    if (body.credential !== undefined) {
      const credential = body.credential as { kind?: unknown; username?: unknown; secret?: unknown };
      if (!credential || typeof credential !== "object" || (credential.kind !== "https" && credential.kind !== "ssh") || typeof credential.secret !== "string" || !credential.secret || (credential.username !== undefined && typeof credential.username !== "string")) {
        throw new Error("Invalid Git credential");
      }
    }
    const summary = await runGitAction(cwd, body.action as GitAction, body as Parameters<typeof runGitAction>[2]);
    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === "Access denied" ? 403 : 400 });
  }
}
