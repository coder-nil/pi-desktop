import { NextResponse } from "next/server";
import { runNpx } from "@/lib/npx";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getProjectTrustStatus } from "@/lib/project-trust";
import { formatSkillCommandOutput } from "@/lib/skill-command-output";
import { getSystemProxyEnvironment } from "@/lib/system-proxy";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

const SKILLS_REMOVE_TIMEOUT_MS = 60_000;
const SKILLS_OUTPUT_MAX_BUFFER = 8 * 1024 * 1024;

// POST /api/skills/remove  body: { package: string; scope: "global" | "project"; cwd?: string }
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const { package: pkg, scope, cwd } = await req.json() as { package?: string; scope?: string; cwd?: string };
    if (!pkg?.trim()) return NextResponse.json({ error: "package required" }, { status: 400 });

    const isGlobal = scope !== "project";
    if (!isGlobal) {
      if (!cwd) return NextResponse.json({ error: "cwd required for project remove" }, { status: 400 });
      const allowedRoots = await getAllowedFileRoots();
      if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
      if (!getProjectTrustStatus(cwd, getAgentDir()).trusted) {
        return NextResponse.json(
          { error: "Project resources must be trusted before removing project skills" },
          { status: 403 },
        );
      }
    }
    const args = ["skills", "remove", pkg.trim(), "-y", "--agent", "pi"];
    if (isGlobal) args.push("-g");
    const systemProxyEnv = await getSystemProxyEnvironment();

    console.log(`[skills/remove] running: npx ${args.join(" ")}`);
    const { stdout, stderr } = await runNpx(args, {
      timeout: SKILLS_REMOVE_TIMEOUT_MS,
      maxBuffer: SKILLS_OUTPUT_MAX_BUFFER,
      cwd: !isGlobal && cwd ? cwd : undefined,
      env: { ...process.env, ...systemProxyEnv, FORCE_COLOR: "0", GIT_TERMINAL_PROMPT: "0" },
    });

    const output = formatSkillCommandOutput(stdout + stderr);
    // The remove command outputs "Removed X skill(s)" or similar success messages
    const success = /Removed.*skill|Removal complete|skill removed/i.test(output) || stderr.includes(pkg.trim());
    if (!success) {
      return NextResponse.json({ error: output.slice(-300) || "Remove failed" }, { status: 500 });
    }
    return NextResponse.json({ success: true, output });
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const output = formatSkillCommandOutput((err.stdout ?? "") + (err.stderr ?? ""));
    return NextResponse.json({ error: output || (err.message ?? String(e)) }, { status: 500 });
  }
}
