import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { getMcpCatalogEntry } from "@/lib/mcp-catalog";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getProjectTrustStatus } from "@/lib/project-trust";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const execFileAsync = promisify(execFile);
const TEST_TIMEOUT_MS = 10_000;

function configPath(cwd: string): string {
  return join(resolve(cwd), ".mcp.json");
}

function readConfiguredServer(cwd: string, serverName: string): Record<string, unknown> | null {
  const path = configPath(cwd);
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf8")) as { mcpServers?: unknown };
  if (!raw.mcpServers || typeof raw.mcpServers !== "object" || Array.isArray(raw.mcpServers)) return null;
  const server = (raw.mcpServers as Record<string, unknown>)[serverName];
  return server && typeof server === "object" && !Array.isArray(server) ? server as Record<string, unknown> : null;
}

async function validateCwd(value: unknown): Promise<string | NextResponse> {
  if (typeof value !== "string" || !value.trim()) return NextResponse.json({ error: "cwd required" }, { status: 400 });
  const cwd = resolve(value);
  const roots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, roots)) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  return cwd;
}

async function testHttpServer(serverName: string, url: string): Promise<{ status: string; message: string; httpStatus?: number }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "pi-desktop", version: "0.1.0" },
        },
      }),
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    if (response.status === 401 || response.status === 403) {
      return { status: "auth-required", message: `${serverName} is reachable but requires authorization.`, httpStatus: response.status };
    }
    if (!response.ok) {
      return { status: "failed", message: `${serverName} responded with HTTP ${response.status}.`, httpStatus: response.status };
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("event-stream")) {
      return { status: "passed", message: `${serverName} responded as an MCP endpoint.`, httpStatus: response.status };
    }
    const text = (await response.text()).slice(0, 4096);
    if (/"jsonrpc"\s*:\s*"2\.0"/.test(text)) {
      return { status: "passed", message: `${serverName} responded as an MCP endpoint.`, httpStatus: response.status };
    }
    return { status: "unknown", message: `${serverName} responded, but the MCP protocol could not be confirmed.`, httpStatus: response.status };
  } catch (error) {
    return { status: "failed", message: `${serverName} could not be reached: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function testCommandServer(serverName: string, command: string): Promise<{ status: string; message: string }> {
  try {
    await execFileAsync(command, ["--version"], { timeout: TEST_TIMEOUT_MS, windowsHide: true });
    return { status: "configured", message: `${serverName} is configured. Its local process will start when an MCP tool is used.` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { status: "failed", message: `${serverName} command "${command}" is not available: ${detail}` };
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
    if (trust.requiresTrust && !trust.trusted) return NextResponse.json({ error: "Trust this project before testing MCP servers" }, { status: 403 });
    const server = readConfiguredServer(cwd, preset.id);
    if (!server) return NextResponse.json({ error: `${preset.name} is not configured in .mcp.json` }, { status: 409 });
    if (typeof server.url === "string" && server.url.trim()) return NextResponse.json(await testHttpServer(preset.name, server.url));
    if (typeof server.command === "string" && server.command.trim()) return NextResponse.json(await testCommandServer(preset.name, server.command));
    return NextResponse.json({ status: "failed", message: `${preset.name} has neither a URL nor a command configured.` });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}
