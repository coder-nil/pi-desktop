import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { execPath } from "process";

const execFileAsync = promisify(execFile);

/**
 * Locate `npx-cli.js` shipped with the running Node.js installation.
 *
 * On Windows the `npx` on PATH is actually `npx.cmd`, which Node.js (since
 * 20.12 due to CVE-2024-27980) refuses to spawn from `execFile`/`spawn`
 * without `shell: true`. Going through a shell reintroduces quoting bugs for
 * user-supplied args. Instead we find the real `npx-cli.js` and invoke it
 * directly via the current `node` binary, which works identically on every
 * platform and needs no shell.
 */
function findNpxCli(): { path: string; layout: string } | null {
  const nodeDir = dirname(execPath);
  const candidates = [
    // Windows MSI installer layout: node.exe and node_modules share a dir
    { path: join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js"), layout: "Windows MSI" },
    // Unix layout: .../bin/node + .../lib/node_modules/npm/bin/npx-cli.js
    { path: join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js"), layout: "Unix/nvm" },
  ];
  for (const { path, layout } of candidates) {
    try {
      if (existsSync(path)) return { path, layout };
    } catch {
      // ignore
    }
  }
  return null;
}

export interface RunNpxOptions {
  timeout?: number;
  maxBuffer?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface RunNpxResult {
  stdout: string;
  stderr: string;
}

/**
 * Cross-platform wrapper for invoking `npx <args>` without ever using a
 * shell, so user-controlled arguments are never interpreted as shell syntax.
 */
export async function runNpx(args: string[], opts: RunNpxOptions = {}): Promise<RunNpxResult> {
  const npxCli = findNpxCli();
  
  console.log('[npx] execPath:', execPath);
  console.log('[npx] findNpxCli result:', npxCli);
  
  if (!npxCli) {
    throw new Error(
      `Cannot locate npx-cli.js for Node.js at ${execPath}. ` +
      `Please ensure npm is installed globally. ` +
      `You may need to run 'npm install -g npm' or reinstall Node.js.`
    );
  }

  console.log(`[npx] using ${npxCli.layout} layout: ${npxCli.path}`);
  
  const command = execPath;
  const commandArgs = [npxCli.path, ...args];
  
  console.log(`[npx] executing: ${command} ${commandArgs.join(' ')}`);
  console.log(`[npx] cwd: ${opts.cwd || process.cwd()}`);
  console.log(`[npx] env.PATH: ${opts.env?.PATH || process.env.PATH}`);
  
  try {
    return await execFileAsync(command, commandArgs, {
      timeout: opts.timeout,
      maxBuffer: opts.maxBuffer,
      cwd: opts.cwd,
      env: opts.env,
    });
  } catch (error) {
    const err = error as { code?: string; message?: string; errno?: number };
    console.error('[npx] execution failed:', err);
    
    if (err.code === 'ENOENT' || err.errno === -2) {
      throw new Error(
        `Failed to spawn Node.js process (${execPath}). ` +
        `This usually means the environment is misconfigured or the file does not exist. ` +
        `Error: ${err.message}`
      );
    }
    throw error;
  }
}
