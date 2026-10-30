import { createWriteStream } from "node:fs";
import { access, chmod, cp, mkdir, mkdtemp, readdir, readFile, rename, rm } from "node:fs/promises";
import { get } from "node:https";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BUNDLED_NPM_PACKAGE_PATH, writeBundledNpmLaunchers } from "./bundled-npm.mjs";
import { backfillMissingServerChunks, describeBuildIdMismatch, describeMissingServerChunks, readBuildId } from "./server-chunk-check.mjs";

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
      await execFileAsync("tar.exe", ["-xf", archivePath, "-C", temporaryDirectory]);
    } else {
      await execFileAsync("unzip", ["-q", archivePath, "-d", temporaryDirectory]);
    }
  } else {
    await execFileAsync("tar", ["-xJf", archivePath, "-C", temporaryDirectory]);
  }

  const extractedRoot = join(temporaryDirectory, basename(archiveName, `.${archiveExtension}`));
  return {
    executable: join(extractedRoot, target.startsWith("win-") ? "node.exe" : "bin/node"),
    npmPackage: join(extractedRoot, target.startsWith("win-") ? "node_modules/npm" : "lib/node_modules/npm"),
  };
}

/**
 * 随 app 打包一份 npm。
 *
 * pi 的包管理器用裸命令名 `npm` spawn，libuv 只按 `process.env.PATH` 解析。
 * `lib/host-tool-path.ts` 会先去找用户机器上的 npm，找不到时才把这里的目录
 * （`PI_DESKTOP_RUNTIME_DIR`）前置到 PATH，所以装了 Node.js 的机器行为不变，
 * 没装的也能安装/更新插件。
 *
 * npm 包本身（含它自己的 LICENSE）原样拷过来，可执行入口由
 * `scripts/bundled-npm.mjs` 生成的启动器提供。
 */
async function prepareBundledNpm(npmSource) {
  const npmDestination = join(outputRoot, ...BUNDLED_NPM_PACKAGE_PATH);
  try {
    await access(join(npmSource, "bin", "npm-cli.js"));
  } catch {
    throw new Error(`The Node.js distribution does not contain npm at ${npmSource}`);
  }
  await cp(npmSource, npmDestination, { recursive: true });
  await writeBundledNpmLaunchers(outputRoot);
}

async function prepareNode(target) {
  const supportedTargets = new Set(["darwin-arm64", "darwin-x64", "win-x64", "linux-x64"]);
  if (!supportedTargets.has(target)) {
    throw new Error(`Unsupported desktop Node target: ${target}`);
  }
  const nodeOutput = join(outputRoot, target.startsWith("win-") ? "node.exe" : "node");
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-desktop-node-"));
  try {
    const { executable, npmPackage } = await extractNode(target, temporaryDirectory);
    await cp(executable, nodeOutput);
    if (process.platform !== "win32") await chmod(nodeOutput, 0o755);
    await prepareBundledNpm(npmPackage);
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

/**
 * 校验打包后的 server bundle 是否缺 webpack chunk，缺的从构建输出补回来。
 *
 * `output: "standalone"` 会把被动态引用的 chunk 交给自己那套 `files` 列表来复制，
 * 漏掉一个就足够让引用它的路由在用户机器上以纯文本 `500 Internal Server Error`
 * 失败——前端只看到 `Unexpected token 'I', "Internal S"... is not valid JSON`，
 * 从现象完全看不出是打包缺文件（Windows 产物上已实测）。
 *
 * 所以这里不再只是"发现缺失就失败"：同一次构建里 `.next/server/chunks` 与 standalone
 * 里的同名 chunk 是逐字节相同的（新增代码引入的异步 chunk 最容易在 Windows 上被漏掉），
 * 缺的按 id 从源头补回来，并把补了哪些打进构建日志。只有源头也没有该 id 时才失败——
 * 那说明构建本身不完整，补不了。
 *
 * 补之前先比对两份 BUILD_ID：`desktop:prepare:frontend` 的静态导出会覆盖 `.next/server`，
 * 那种情况下源头虽然还在、但已经不是 standalone 的那份构建，报错必须把这件事说清楚，
 * 否则只会看到“源头也没有这个 chunk”而找不到真正的原因。
 */
async function verifyStandaloneChunks() {
  const packagedNext = join(serverOutput, ".next");
  const sourceNext = join(root, ".next");
  const packagedServer = join(packagedNext, "server");
  const buildIdMismatch = describeBuildIdMismatch(
    await readBuildId(packagedNext),
    await readBuildId(sourceNext),
  );
  if (buildIdMismatch) console.warn(buildIdMismatch);
  const { restored, unresolved } = await backfillMissingServerChunks(
    packagedServer,
    join(sourceNext, "server"),
  );
  if (restored.length > 0) {
    console.warn(
      `standalone 漏复制了 ${restored.length} 个 webpack chunk，已从 .next/server/chunks 补回：`
      + restored.map(({ id }) => `chunks/${id}.js`).join(", "),
    );
  }
  if (unresolved.length > 0) {
    throw new Error(
      [describeMissingServerChunks(unresolved, packagedServer), buildIdMismatch]
        .filter(Boolean)
        .join("\n\n"),
    );
  }
}

async function removeUnusedSharpRuntime() {
  const nodeModules = join(serverOutput, "node_modules");
  await rm(join(nodeModules, "sharp"), { recursive: true, force: true });

  const imgPackages = join(nodeModules, "@img");
  let entries = [];
  try {
    entries = await readdir(imgPackages, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("sharp-"))
    .map((entry) => rm(join(imgPackages, entry.name), { recursive: true, force: true })));
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
await verifyStandaloneChunks();
await removeUnusedSharpRuntime();
await prepareStaticFrontend();
const nativeModules = await findNativeModules(serverOutput);
if (nativeModules.length > 0) {
  throw new Error(`Desktop standalone output contains unsupported native modules:\n${nativeModules.join("\n")}`);
}
await prepareNode(nodeTarget);
console.log(`Prepared desktop runtime for ${nodeTarget} in ${outputRoot}`);
