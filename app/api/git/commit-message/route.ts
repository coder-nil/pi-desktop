import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { createAgentSessionServices, getAgentDir, type AgentSession } from "@earendil-works/pi-coding-agent";
import { generateCommitMessage, generateCommitMessageWithModel } from "@/lib/commit-message";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { getStagedDiff } from "@/lib/git-manager";
import { resolveVisibleModels, selectInitialModelScope } from "@/lib/model-scope";
import { projectTrustReloadOptions } from "@/lib/project-trust";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";
import { createDesktopModelRuntime, refreshDesktopProviderCatalogs } from "@/lib/desktop-providers";

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
    const cwd = await validateCwd(body.cwd);
    const stagedDiff = await getStagedDiff(cwd);
    let message: string;

    if (typeof body.sessionId === "string" && body.sessionId) {
      const filePath = await resolveSessionPath(body.sessionId);
      if (!filePath) return NextResponse.json({ error: "Session not found" }, { status: 404 });
      const existing = getRpcSession(body.sessionId);
      const { session } = existing?.isAlive()
        ? { session: existing }
        : await startRpcSession(body.sessionId, filePath, undefined);
      await session.waitUntilReady?.();
      message = await generateCommitMessage(session.inner as unknown as AgentSession, stagedDiff);
    } else {
      const agentDir = getAgentDir();
      const trustReloadOptions = projectTrustReloadOptions(cwd, agentDir);
      const modelRuntime = await createDesktopModelRuntime({
        authPath: `${agentDir}/auth.json`,
        modelsPath: `${agentDir}/models.json`,
      });
      const services = await createAgentSessionServices({
        cwd,
        agentDir,
        modelRuntime,
        ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
      });
      await refreshDesktopProviderCatalogs(services.modelRuntime).catch(() => {});
      const scope = await resolveVisibleModels(
        services.modelRuntime,
        services.settingsManager.getEnabledModels(),
      );
      const defaultProvider = services.settingsManager.getDefaultProvider();
      const defaultModelId = services.settingsManager.getDefaultModel();
      const initial = selectInitialModelScope(scope, {
        ...(defaultProvider && defaultModelId
          ? { defaultModel: { provider: defaultProvider, modelId: defaultModelId } }
          : {}),
      });
      if (!initial.model) throw new Error("No available model configured for commit-message generation");
      message = await generateCommitMessageWithModel(services.modelRuntime, initial.model, stagedDiff);
    }
    return NextResponse.json({ message });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === "Access denied" ? 403 : 400 });
  }
}
