import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { open, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describeMissingServerChunks, findMissingServerChunks } from "./server-chunk-check.mjs";
import { BUNDLED_NPM_PACKAGE_PATH } from "./bundled-npm.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = join(root, "desktop-dist");
const serverRoot = join(runtimeRoot, "server");
const useSystemNode = process.argv.includes("--system-node");
const nodeBinary = useSystemNode
  ? process.execPath
  : join(runtimeRoot, process.platform === "win32" ? "node.exe" : "node");
const embeddedNodeBinary = join(runtimeRoot, process.platform === "win32" ? "node.exe" : "node");
const logPath = join(tmpdir(), `pi-desktop-smoke-${process.pid}.log`);
const codingAgentRoot = join(serverRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist");
const requiredRuntimeAssets = [
  join(codingAgentRoot, "modes", "interactive", "theme", "dark.json"),
  join(codingAgentRoot, "modes", "interactive", "theme", "light.json"),
  // 主题 schema 自 pi 1.2.0 起由 `theme-schema.js` 在运行时生成，静态文件改为
  // 发布在远端 `https://pi.dev/schemas/theme.schema.json`，不再随 dist 分发。
  join(codingAgentRoot, "modes", "interactive", "assets", "clankolas.png"),
  join(codingAgentRoot, "core", "export-html", "template.html"),
  join(codingAgentRoot, "core", "export-html", "template.css"),
  join(codingAgentRoot, "core", "export-html", "template.js"),
  join(codingAgentRoot, "core", "export-html", "vendor", "marked.min.js"),
  join(codingAgentRoot, "core", "export-html", "vendor", "highlight.min.js"),
];

async function reservePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a loopback port.");
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

async function waitUntilReady(url, child, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Desktop server exited during startup with code ${child.exitCode}.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok || (response.status >= 300 && response.status < 400)) return;
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }
  throw new Error("Desktop server did not become ready within 45 seconds.");
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = once(child, "exit");
  const timeout = new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000, "timeout"));
  if (await Promise.race([exited, timeout]) === "timeout") {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
}

const nodeHandle = await open(embeddedNodeBinary, "r");
const serverHandle = await open(join(serverRoot, "server.js"), "r");
await Promise.all([nodeHandle.close(), serverHandle.close()]);
// 随 app 打包的 npm：没装 Node.js 的机器上「安装/更新插件」靠这一份。
// 除了文件存在（两个平台的启动器都检查，交叉打包也能验），真实执行一次启动器：
// 它能跑通就说明 basedir 推导、node 路径、npm-cli.js 位置三件事都对。
const npmLauncher = join(runtimeRoot, process.platform === "win32" ? "npm.cmd" : "npm");
const npmPackageCli = join(runtimeRoot, ...BUNDLED_NPM_PACKAGE_PATH, "bin", "npm-cli.js");
for (const file of [npmLauncher, npmPackageCli, join(runtimeRoot, "npm.cmd"), join(runtimeRoot, "npx")]) {
  const handle = await open(file, "r");
  await handle.close();
}
{
  const version = spawn(npmLauncher, ["--version"], {
    cwd: runtimeRoot,
    // 把 runtime 之外的 PATH 拿掉：打包版从 Dock 启动时也没有用户的 node 目录，
    // 启动器必须自包含，不能靠外面的 `node` 才能跑起来。
    // Windows 上 spawn 一个 .cmd 必须经过 shell（Node 对 CVE-2024-27980 的处理），
    // 而 cmd.exe 本身要靠 system32 才起得来，所以那里只留 system32。
    env: process.platform === "win32"
      ? { ...process.env, PATH: process.env.SystemRoot ? `${process.env.SystemRoot}\\system32` : "" }
      : { PATH: "/usr/bin:/bin" },
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  version.stdout.on("data", (chunk) => { stdout += chunk; });
  version.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code] = await once(version, "exit");
  if (code !== 0 || !/^\d+\.\d+\.\d+/.test(stdout.trim())) {
    throw new Error(`Bundled npm launcher failed (code ${code}): ${(stderr || stdout).slice(0, 400)}`);
  }
  console.log(`Bundled npm ${stdout.trim()} runs from ${npmLauncher}.`);
}
// 先静态检查一遍再启动：缺 webpack chunk 时服务本身能起来，只有引用它的路由会在
// 用户机器上回纯文本 500。这里提前失败，冒烟输出能直接说清楚缺了什么。
const missingChunks = await findMissingServerChunks(join(serverRoot, ".next", "server"));
if (missingChunks.length > 0) {
  throw new Error(describeMissingServerChunks(missingChunks, join(serverRoot, ".next", "server")));
}
for (const assetPath of requiredRuntimeAssets) {
  const assetHandle = await open(assetPath, "r");
  await assetHandle.close();
}
const port = await reservePort();
const log = createWriteStream(logPath, { flags: "a" });
await once(log, "open");
const child = spawn(nodeBinary, ["server.js"], {
  cwd: serverRoot,
  env: {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    PI_WEB_HOSTNAME: "127.0.0.1",
    PI_WEB_NO_OPEN: "1",
  },
  stdio: ["ignore", log, log],
});

try {
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitUntilReady(`${baseUrl}/`, child);
  // 「关于」对话框的变更记录走这个路由：数据是构建期嵌进包里的，
  // 一旦 standalone 追踪漏了 `data/changelog.json`，这里就会先于用户报错。
  const changelogResponse = await fetch(`${baseUrl}/api/changelog`, { signal: AbortSignal.timeout(5_000) });
  if (!changelogResponse.ok) throw new Error(`GET /api/changelog answered HTTP ${changelogResponse.status}.`);
  const changelog = await changelogResponse.json();
  if (!Array.isArray(changelog.releases) || changelog.releases.length === 0) {
    throw new Error("GET /api/changelog returned no releases; check data/changelog.json in the bundle.");
  }

  // 这些路由各自被拆进了异步 chunk，正是最容易在 standalone 里漏文件的那批。
  // 它们必须「回 JSON」而不只是「回 2xx」：缺 chunk 时 Next 会回纯文本
  // `Internal Server Error`，前端只会看到 `Unexpected token 'I'… is not valid JSON`。
  const probeRoutes = [
    "/api/sessions",
    "/api/skills",
    "/api/git?cwd=" + encodeURIComponent(serverRoot),
  ];
  for (const route of probeRoutes) {
    const response = await fetch(`${baseUrl}${route}`, { signal: AbortSignal.timeout(15_000) });
    if (response.status >= 500) {
      throw new Error(`GET ${route} answered HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      throw new Error(`GET ${route} answered ${contentType || "no content type"} instead of JSON: ${(await response.text()).slice(0, 200)}`);
    }
    await response.arrayBuffer();
  }

  console.log(`Desktop standalone server became ready on port ${port} (${changelog.releases.length} bundled releases, ${probeRoutes.length} API routes answered JSON).`);
} finally {
  await stopChild(child);
  await new Promise((resolveClose) => log.end(resolveClose));
  await rm(logPath, { force: true });
}
