import { NextResponse } from "next/server";
import { runNpx } from "@/lib/npx";
import type { SkillInstallScope } from "@/lib/api-types";
import { buildSkillUpdateArgs } from "@/lib/skill-updates";
import { loadSkillsWithInstallInfo } from "@/lib/skills-service";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { formatSkillCommandOutput } from "@/lib/skill-command-output";
import { getSystemProxyEnvironment } from "@/lib/system-proxy";

export const dynamic = "force-dynamic";

// 与 install 保持一致：skills CLI 允许 5 分钟克隆仓库。原来的 60 秒会在网络慢时
// 把正在进行的克隆判成失败，而残留输出里只有 banner 和 spinner 帧，看不出原因。
const SKILLS_UPDATE_TIMEOUT_MS = 310_000;
const SKILLS_OUTPUT_MAX_BUFFER = 8 * 1024 * 1024;

// POST /api/skills/update  body: { cwd, package, scope }
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as {
      cwd?: unknown;
      package?: unknown;
      scope?: unknown;
    };
    const cwd = typeof body.cwd === "string" ? body.cwd : "";
    const pkg = typeof body.package === "string" ? body.package : "";
    const scope = body.scope === "global" || body.scope === "project"
      ? body.scope as SkillInstallScope
      : undefined;
    if (!cwd || !pkg || !scope) {
      return NextResponse.json({ error: "cwd, package, and scope are required" }, { status: 400 });
    }
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { skills } = await loadSkillsWithInstallInfo(cwd);
    const skill = skills.find(
      (item) => item.install?.package === pkg && item.install.scope === scope,
    );
    if (!skill?.install) {
      return NextResponse.json({ error: "Installed skill not found" }, { status: 404 });
    }
    if (!skill.install.canCheckForUpdates) {
      return NextResponse.json({ error: "This skill cannot be updated automatically" }, { status: 400 });
    }

    const args = buildSkillUpdateArgs(skill.install);
    const systemProxyEnv = await getSystemProxyEnvironment();

    console.log(`[skills/update] running: npx ${args.join(" ")}`);
    const { stdout, stderr } = await runNpx(args, {
      timeout: SKILLS_UPDATE_TIMEOUT_MS,
      maxBuffer: SKILLS_OUTPUT_MAX_BUFFER,
      cwd: scope === "project" ? cwd : undefined,
      env: { ...process.env, ...systemProxyEnv, FORCE_COLOR: "0", GIT_TERMINAL_PROMPT: "0" },
    });

    const refreshed = await loadSkillsWithInstallInfo(cwd);
    const updatedSkill = refreshed.skills.find(
      (item) => item.install?.package === pkg && item.install.scope === scope,
    );
    return NextResponse.json({
      success: true,
      skill: updatedSkill,
      output: formatSkillCommandOutput(stdout + stderr),
    });
  } catch (error: unknown) {
    const detail = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
      killed?: boolean;
      signal?: string;
    };
    const output = formatSkillCommandOutput((detail.stdout ?? "") + (detail.stderr ?? ""));
    // 克隆仓库是纯网络操作：超时或被杀时只回显 "signal: SIGTERM" 毫无信息量。
    const reason = detail.killed || detail.signal
      ? `克隆仓库超时或被中断（上限 ${Math.round(SKILLS_UPDATE_TIMEOUT_MS / 1000)} 秒）。请确认能访问 GitHub 后重试；若使用代理，请先在系统设置中配置。`
      : "";
    return NextResponse.json(
      { error: [output, reason, detail.message].filter(Boolean).join("\n\n") || String(error) },
      { status: 500 },
    );
  }
}
