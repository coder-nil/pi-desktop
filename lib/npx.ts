// npx.ts - Cross-platform npx invoker for skills operations
import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { execPath } from "process";

const execFileAsync = promisify(execFile);

interface NpxLocation {
  path: string;
  layout: string;
  nodeBin: string;
}

/**
 * Try to locate `npx-cli.js` in various Node.js installations.
 * Priority order:
 *   1. npm bundled with the current Node.js (for standard installs)
 *   2. Common system-wide paths (Homebrew, macOS pkg, Linux common)
 *   3. NVM installations (newest to oldest)
 */
function findNpxCli(): NpxLocation | null {
  // 1. Check the Node.js binary's own npm bundle (for standard installs)
  const nodeDir = dirname(execPath);
  const directCandidates: { path: string; layout: string }[] = [
    // Windows MSI installer layout: node.exe and node_modules share a dir
    { path: join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js"), layout: "Windows MSI" },
    // Unix layout: .../bin/node + .../lib/node_modules/npm/bin/npx-cli.js
    { path: join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js"), layout: "Unix/nvm/brew" },
    // macOS pkg (legacy but still possible)
    { path: join(nodeDir, "../lib/node_modules/npm/bin/npx-cli.js"), layout: "macOS pkg" },
  ];
  
  for (const { path, layout } of directCandidates) {
    if (existsSync(path)) {
      console.log(`[npx] Found npx-cli.js at ${path} (${layout})`);
      return { path, layout, nodeBin: execPath };
    }
  }

  // 2. Try common system-wide locations (only on Unix/macOS/Linux)
  const systemCandidates: { path: string; nodeBin: string }[] = [
    // macOS Homebrew (Apple Silicon)
    { path: "/opt/homebrew/lib/node_modules/npm/bin/npx-cli.js", nodeBin: "/opt/homebrew/bin/node" },
    // macOS Homebrew (Intel) and many Linux distros
    { path: "/usr/local/lib/node_modules/npm/bin/npx-cli.js", nodeBin: "/usr/local/bin/node" },
    // Debian/Ubuntu default
    { path: "/usr/lib/node_modules/npm/bin/npx-cli.js", nodeBin: "/usr/bin/node" },
  ];

  for (const { path, nodeBin } of systemCandidates) {
    if (existsSync(path) && existsSync(nodeBin)) {
      console.log(`[npx] Found npx-cli.js at ${path} (system, using ${nodeBin})`);
      return { path, layout: "System", nodeBin };
    }
  }

  // 3. Probe NVM installations (scan all versions, pick newest with npm)
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home) {
    const nvmVersionsDir = join(home, ".nvm", "versions", "node");
    if (existsSync(nvmVersionsDir)) {
      try {
        const entries = readdirSync(nvmVersionsDir, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => d.name)
          // Sort versions descending (newest first): v24.20.0 > v22.19.0 > v18.20.8
          .sort((a, b) => {
            const extractVersion = (s: string): number[] => s.replace(/^v/, "").split(".").map(Number);
            const va = extractVersion(a);
            const vb = extractVersion(b);
            for (let i = 0; i < Math.max(va.length, vb.length); i++) {
              const av = va[i] ?? 0;
              const bv = vb[i] ?? 0;
              if (av !== bv) return bv - av;
            }
            return 0;
          });

        for (const version of entries) {
          const npxPath = join(nvmVersionsDir, version, "lib", "node_modules", "npm", "bin", "npx-cli.js");
          const nodePath = join(nvmVersionsDir, version, "bin", "node");
          if (existsSync(npxPath) && existsSync(nodePath)) {
            console.log(`[npx] Found npx-cli.js at ${npxPath} (NVM ${version})`);
            return { path: npxPath, layout: `NVM ${version}`, nodeBin: nodePath };
          }
        }
      } catch (e) {
        console.error("[npx] Failed to scan NVM versions:", e);
      }
    }
  }

  return null;
}

export interface RunNpxOptions {
  timeout?: number;
  maxBuffer?: number;
  cwd?: string;
  env?: Record<string, string>;
}

export interface RunNpxResult {
  stdout: string;
  stderr: string;
}

/**
 * Cross-platform wrapper for invoking `npx <args>` without ever using a shell,
 * so user-controlled arguments are never interpreted as shell syntax.
 * 
 * This function will:
 * 1. First try to find npx-cli.js bundled with the current Node.js
 * 2. Fall back to system-wide npm installations (Homebrew, /usr/local, etc.)
 * 3. Scan NVM installations (newest to oldest)
 * 4. Throw a descriptive error if nothing is found
 */
export async function runNpx(args: string[], opts: RunNpxOptions = {}): Promise<RunNpxResult> {
  const npxCli = findNpxCli();
  
  console.log("[npx] Current execPath:", execPath);
  console.log("[npx] findNpxCli result:", npxCli ? { path: "<hidden>", layout: npxCli.layout, nodeBin: "<hidden>" } : null);
  
  if (!npxCli) {
    const nvmHint = process.env.HOME 
      ? `Check ~/.nvm/versions/node/ for Node.js installations with npm.`
      : "Reinstall Node.js with npm included.";
    
    throw new Error(
      `Cannot locate npx-cli.js. The bundled Node.js in Pi Desktop does not include npm.\n` +
      `Searched in:\n` +
      `  - Bundled with: ${execPath}\n` +
      `  - Common system paths (/opt/homebrew, /usr/local, /usr)\n` +
      `  - NVM installations in ${process.env.HOME || "~"}\n\n` +
      `Solutions:\n` +
      `  1. Ensure Node.js is installed globally (via nvm or other installer)\n` +
      `  2. Or run 'npm install -g npm' in a terminal to restore npm\n\n` +
      `${nvmHint}`
    );
  }

  console.log(`[npx] Using npx from ${npxCli.layout}: ${npxCli.path}`);
  console.log(`[npx] Will use node binary: ${npxCli.nodeBin}`);
  
  const command = npxCli.nodeBin;
  const commandArgs = [npxCli.path, ...args];
  
  const effectiveCwd = opts.cwd || process.cwd();
  const effectiveEnv = { ...process.env, ...(opts.env || {}), FORCE_COLOR: "0", GIT_TERMINAL_PROMPT: "0" };

  console.log(`[npx] Executing: ${command} ${commandArgs.join(" ")}`);
  console.log(`[npx] Working directory: ${effectiveCwd}`);

  try {
    const result = await execFileAsync(command, commandArgs, {
      timeout: opts.timeout,
      maxBuffer: opts.maxBuffer,
      cwd: effectiveCwd,
      env: effectiveEnv,
    });
    
    console.log(`[npx] Success: ${result.stdout.length} bytes output`);
    return { stdout: result.stdout || "", stderr: result.stderr || "" };
  } catch (error) {
    const err = error as { code?: string; message?: string; errno?: number; stdout?: string; stderr?: string };
    console.error("[npx] Execution failed:", { code: err.code, message: err.message });
    if (err.stdout) console.error("[npx] stdout:", err.stdout.substring(0, 500));
    if (err.stderr) console.error("[npx] stderr:", err.stderr.substring(0, 500));
    
    if (err.code === "ENOENT" || err.errno === -2) {
      throw new Error(
        `Failed to spawn Node.js process at ${command}.\n` +
        `This usually means:\n` +
        `  - The node binary at ${command} does not exist or is not executable\n` +
        `  - Environment permissions are preventing execution\n\n` +
        `Original error: ${err.message}`
      );
    }
    
    // Re-throw the original error for better context
    throw error;
  }
}
