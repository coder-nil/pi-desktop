import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { EnvHttpProxyAgent, fetch } from "undici";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const toolsRoot = join(root, "src-tauri", "target", ".tauri");
const nsisRoot = join(toolsRoot, "NSIS");
const nsisUrl = "https://github.com/tauri-apps/binary-releases/releases/download/nsis-3/nsis-3.zip";
const nsisSha1 = "057e83c7d82462ec394af76c87d06733605543d4";
const pluginUrl = "https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.1/nsis_tauri_utils.dll";
const pluginSha1 = "b053b2e5fdb97257954c8f935d80964f056520ae";
const pluginRelativePath = join("Plugins", "x86-unicode", "additional", "nsis_tauri_utils.dll");
const requiredFiles = [
  "makensis.exe",
  join("Bin", "makensis.exe"),
  join("Stubs", "lzma-x86-unicode"),
  join("Stubs", "lzma_solid-x86-unicode"),
  pluginRelativePath,
  join("Include", "MUI2.nsh"),
  join("Include", "FileFunc.nsh"),
  join("Include", "x64.nsh"),
  join("Include", "nsDialogs.nsh"),
  join("Include", "WinMessages.nsh"),
];
const dispatcher = new EnvHttpProxyAgent({ allowH2: false });

function sha1(data) {
  return createHash("sha1").update(data).digest("hex");
}

async function toolsetIsValid() {
  try {
    await Promise.all(requiredFiles.map((path) => access(join(nsisRoot, path))));
    return sha1(await readFile(join(nsisRoot, pluginRelativePath))) === pluginSha1;
  } catch {
    return false;
  }
}

async function downloadVerified(url, destination, expectedSha1, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        dispatcher,
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const data = Buffer.from(await response.arrayBuffer());
      const actualSha1 = sha1(data);
      if (actualSha1 !== expectedSha1) {
        throw new Error(`SHA-1 mismatch: expected ${expectedSha1}, received ${actualSha1}`);
      }
      await writeFile(destination, data);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        const delayMs = 5_000 * attempt;
        console.warn(`Download attempt ${attempt} failed for ${url}; retrying in ${delayMs / 1000}s.`);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
      }
    }
  }
  throw new Error(`Could not download ${url} after ${attempts} attempts.`, { cause: lastError });
}

if (await toolsetIsValid()) {
  console.log(`Tauri NSIS tools are ready in ${nsisRoot}`);
  process.exit(0);
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-desktop-nsis-"));
const stagingRoot = join(toolsRoot, `NSIS.staging-${process.pid}`);
try {
  const archivePath = join(temporaryDirectory, "nsis-3.zip");
  const pluginPath = join(temporaryDirectory, "nsis_tauri_utils.dll");
  await downloadVerified(nsisUrl, archivePath, nsisSha1);
  await downloadVerified(pluginUrl, pluginPath, pluginSha1);

  await execFileAsync(process.platform === "win32" ? "tar.exe" : "tar", [
    "-xf",
    archivePath,
    "-C",
    temporaryDirectory,
  ]);

  await mkdir(toolsRoot, { recursive: true });
  await rm(stagingRoot, { recursive: true, force: true });
  await cp(join(temporaryDirectory, "nsis-3.08"), stagingRoot, { recursive: true });
  const stagedPlugin = join(stagingRoot, pluginRelativePath);
  await mkdir(dirname(stagedPlugin), { recursive: true });
  await cp(pluginPath, stagedPlugin);

  await rm(nsisRoot, { recursive: true, force: true });
  await rename(stagingRoot, nsisRoot);
  if (!await toolsetIsValid()) throw new Error("Prepared NSIS toolset is incomplete.");
  console.log(`Prepared and verified Tauri NSIS tools in ${nsisRoot}`);
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
  await rm(temporaryDirectory, { recursive: true, force: true });
  await dispatcher.close();
}
