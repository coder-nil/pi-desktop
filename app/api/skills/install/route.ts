import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { runNpx } from "@/lib/npx";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getProjectTrustStatus } from "@/lib/project-trust";
import { formatSkillCommandOutput } from "@/lib/skill-command-output";
import { getSystemProxyEnvironment } from "@/lib/system-proxy";

export const dynamic = "force-dynamic";

// The skills CLI allows five minutes for a repository clone. Do not cut that
// operation short here, and leave a small margin for the remaining install work.
const SKILLS_INSTALL_TIMEOUT_MS = 310_000;
const SKILLS_OUTPUT_MAX_BUFFER = 8 * 1024 * 1024;

// POST /api/skills/install  body: { package: string; scope: "global" | "project"; cwd?: string }
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
      if (!cwd) return NextResponse.json({ error: "cwd required for project install" }, { status: 400 });
      const allowedRoots = await getAllowedFileRoots();
      if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
      if (!getProjectTrustStatus(cwd, getAgentDir()).trusted) {
        return NextResponse.json(
          { error: "Project resources must be trusted before installing project skills" },
          { status: 403 },
        );
      }
    }
    const args = ["skills", "add", pkg.trim(), "-y", "--agent", "pi"];
    if (isGlobal) args.push("-g");
    const systemProxyEnv = await getSystemProxyEnvironment();

    console.log(`[skills/install] running: npx ${args.join(" ")}`);
    const { stdout, stderr } = await runNpx(args, {
      timeout: SKILLS_INSTALL_TIMEOUT_MS,
      maxBuffer: SKILLS_OUTPUT_MAX_BUFFER,
      cwd: !isGlobal && cwd ? cwd : undefined,
      env: { ...process.env, ...systemProxyEnv, FORCE_COLOR: "0", GIT_TERMINAL_PROMPT: "0" },
    });

    const output = formatSkillCommandOutput(stdout + stderr);
    const success = /Installation complete|Installed \d+ skill/.test(output);
    if (!success) {
      return NextResponse.json({ error: output.slice(-300) || "Install failed" }, { status: 500 });
    }
    return NextResponse.json({ success: true, output });
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const output = formatSkillCommandOutput((err.stdout ?? "") + (err.stderr ?? ""));
    return NextResponse.json({ error: output || (err.message ?? String(e)) }, { status: 500 });
  }
}
