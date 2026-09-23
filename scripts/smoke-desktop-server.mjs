import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { open, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  join(codingAgentRoot, "modes", "interactive", "theme", "theme-schema.json"),
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
  console.log(`Desktop standalone server became ready on port ${port} (${changelog.releases.length} bundled releases).`);
} finally {
  await stopChild(child);
  await new Promise((resolveClose) => log.end(resolveClose));
  await rm(logPath, { force: true });
}
