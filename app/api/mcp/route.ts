import { existsSync, readFileSync, renameSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { NextResponse } from "next/server";
import { getMcpCatalogEntry } from "@/lib/mcp-catalog";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getProjectTrustStatus } from "@/lib/project-trust";

export const dynamic = "force-dynamic";

function configPath(cwd: string): string {
  return join(resolve(cwd), ".mcp.json");
}

function readConfig(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("MCP config root must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function readServers(raw: Record<string, unknown>): Record<string, unknown> {
  const value = raw.mcpServers;
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MCP config mcpServers must be an object");
  }
  return value as Record<string, unknown>;
}

function writeConfig(filePath: string, raw: Record<string, unknown>): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

async function validateCwd(cwdValue: unknown): Promise<string | NextResponse> {
  if (typeof cwdValue !== "string" || !cwdValue.trim()) {
    return NextResponse.json({ error: "cwd required" }, { status: 400 });
  }
  const cwd = resolve(cwdValue);
  try {
    if (!statSync(cwd).isDirectory()) return NextResponse.json({ error: "cwd must be a directory" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Directory does not exist" }, { status: 400 });
  }
  const roots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, roots)) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  return cwd;
}

export async function GET(req: Request) {
  const cwd = await validateCwd(new URL(req.url).searchParams.get("cwd"));
  if (cwd instanceof NextResponse) return cwd;
  const includeContent = new URL(req.url).searchParams.get("includeContent") === "1";
  try {
    const path = configPath(cwd);
    const content = existsSync(path) ? readFileSync(path, "utf8") : "{\n  \"mcpServers\": {}\n}\n";
    try {
      const raw = JSON.parse(content) as Record<string, unknown>;
      const response = { path, servers: Object.keys(readServers(raw)) };
      return NextResponse.json(includeContent ? { ...response, content } : response);
    } catch (error) {
      if (includeContent) {
        return NextResponse.json({ path, content, servers: [], parseError: error instanceof Error ? error.message : String(error) });
      }
      throw error;
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  try {
    const body = await req.json() as { cwd?: unknown; content?: unknown };
    const cwd = await validateCwd(body.cwd);
    if (cwd instanceof NextResponse) return cwd;
    if (typeof body.content !== "string") return NextResponse.json({ error: "content required" }, { status: 400 });
    const trust = getProjectTrustStatus(cwd, getAgentDir());
    if (trust.requiresTrust && !trust.trusted) return NextResponse.json({ error: "Trust this project before editing MCP configuration" }, { status: 403 });
    const parsed = JSON.parse(body.content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "MCP config root must be a JSON object" }, { status: 400 });
    const raw = parsed as Record<string, unknown>;
    const servers = readServers(raw);
    const path = configPath(cwd);
    writeConfig(path, { ...raw, mcpServers: servers });
    return NextResponse.json({ path, servers: Object.keys(servers) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });

  try {
    const body = await req.json() as { cwd?: unknown; presetId?: unknown };
    const cwd = await validateCwd(body.cwd);
    if (cwd instanceof NextResponse) return cwd;
    if (typeof body.presetId !== "string" || !body.presetId.trim()) return NextResponse.json({ error: "presetId required" }, { status: 400 });
    const preset = getMcpCatalogEntry(body.presetId);
    if (!preset) return NextResponse.json({ error: "Unknown MCP preset" }, { status: 404 });

    const trust = getProjectTrustStatus(cwd, getAgentDir());
    if (trust.requiresTrust && !trust.trusted) {
      return NextResponse.json({ error: "Trust this project before adding MCP servers" }, { status: 403 });
    }

    const path = configPath(cwd);
    const raw = readConfig(path);
    const servers = readServers(raw);
    if (servers[preset.id] !== undefined) {
      return NextResponse.json({ path, serverName: preset.id, added: false, servers: Object.keys(servers) });
    }
    const next = { ...raw, mcpServers: { ...servers, [preset.id]: preset.entry } };
    writeConfig(path, next);
    return NextResponse.json({ path, serverName: preset.id, added: true, servers: Object.keys(next.mcpServers) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}
