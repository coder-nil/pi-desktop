import { createWriteStream } from "node:fs";
import { access, chmod, cp, mkdir, mkdtemp, readdir, readFile, rename, rm } from "node:fs/promises";
import { get } from "node:https";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = join(root, "desktop-dist");
const serverOutput = join(outputRoot, "server");
const frontendOutput = join(root, ".next-desktop-frontend");
const nodeVersion = process.env.PI_WEB_DESKTOP_NODE_VERSION || "22.19.0";

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function defaultNodeTarget() {
  const platform = { darwin: "darwin", win32: "win", linux: "linux" }[process.platform];
  const architecture = { arm64: "arm64", x64: "x64" }[process.arch];
  if (!platform || !architecture) {
    throw new Error(`Unsupported desktop build host: ${process.platform}-${process.arch}`);
  }
  return `${platform}-${architecture}`;
}

function download(url, destination, redirectsLeft = 5) {
  return new Promise((resolveDownload, reject) => {
    const request = get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirectsLeft === 0) return reject(new Error(`Too many redirects while downloading ${url}`));
        return resolveDownload(download(new URL(response.headers.location, url), destination, redirectsLeft - 1));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`Download failed (${response.statusCode}) for ${url}`));
      }
      pipeline(response, createWriteStream(destination)).then(resolveDownload, reject);
    });
    request.on("error", reject);
  });
}

async function extractNode(target, temporaryDirectory) {
  const archiveExtension = target.startsWith("win-") ? "zip" : "tar.xz";
  const archiveName = `node-v${nodeVersion}-${target}.${archiveExtension}`;
  const archivePath = join(temporaryDirectory, archiveName);
  await download(`https://nodejs.org/dist/v${nodeVersion}/${archiveName}`, archivePath);

  if (archiveExtension === "zip") {
    if (process.platform === "win32") {
      await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-Command",
        "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force",
        archivePath,
        temporaryDirectory,
      ]);
    } else {
      await execFileAsync("unzip", ["-q", archivePath, "-d", temporaryDirectory]);
    }
  } else {
    await execFileAsync("tar", ["-xJf", archivePath, "-C", temporaryDirectory]);
  }

  const extractedRoot = join(temporaryDirectory, basename(archiveName, `.${archiveExtension}`));
  return join(extractedRoot, target.startsWith("win-") ? "node.exe" : "bin/node");
}

async function prepareNode(target) {
  const nodeOutput = join(outputRoot, target.startsWith("win-") ? "node.exe" : "node");
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-web-node-"));
  try {
    if (target === "darwin-universal") {
      if (process.platform !== "darwin") throw new Error("The universal macOS runtime must be prepared on macOS.");
      const arm64Node = await extractNode("darwin-arm64", temporaryDirectory);
      const x64Node = await extractNode("darwin-x64", temporaryDirectory);
      await execFileAsync("lipo", ["-create", arm64Node, x64Node, "-output", nodeOutput]);
    } else {
      const executable = await extractNode(target, temporaryDirectory);
      await cp(executable, nodeOutput);
    }
    if (process.platform !== "win32") await chmod(nodeOutput, 0o755);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function prepareStandaloneServer() {
  const standaloneRoot = join(root, ".next/standalone");
  const serverEntry = join(standaloneRoot, "server.js");
  try {
    await readFile(serverEntry);
  } catch {
    throw new Error("Next standalone output is missing. Run `npm run build` before preparing the desktop bundle.");
  }

  await cp(standaloneRoot, serverOutput, { recursive: true });
  await mkdir(join(serverOutput, ".next"), { recursive: true });
  await cp(join(root, ".next/static"), join(serverOutput, ".next/static"), { recursive: true });
  await cp(join(root, "public"), join(serverOutput, "public"), { recursive: true });
}

async function prepareStaticFrontend() {
  try {
    await access(join(frontendOutput, "index.html"));
  } catch {
    throw new Error("Desktop frontend export is missing. Run `npm run build:desktop-frontend` before preparing the desktop bundle.");
  }
  await cp(frontendOutput, join(root, "src-tauri", "frontend"), { recursive: true });
}

async function findNativeModules(directory) {
  const matches = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) matches.push(...await findNativeModules(path));
    else if (entry.isFile() && entry.name.endsWith(".node")) matches.push(path);
  }
  return matches;
}

const nodeTarget = option("node-target") || defaultNodeTarget();
const stagingRoot = `${outputRoot}.staging-${process.pid}`;
await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });
await rm(outputRoot, { recursive: true, force: true });
await rename(stagingRoot, outputRoot);
await prepareStandaloneServer();
await prepareStaticFrontend();
const nativeModules = await findNativeModules(serverOutput);
if (nodeTarget === "darwin-universal" && nativeModules.length > 0) {
  throw new Error(`Desktop standalone output contains architecture-specific native modules:\n${nativeModules.join("\n")}`);
}
await prepareNode(nodeTarget);
console.log(`Prepared desktop runtime for ${nodeTarget} in ${outputRoot}`);
