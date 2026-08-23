import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { open } from "node:fs/promises";
import { createServer } from "node:net";
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
const logPath = join(runtimeRoot, "smoke-test.log");

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
  await waitUntilReady(`http://127.0.0.1:${port}/`, child);
  console.log(`Desktop standalone server became ready on port ${port}.`);
} finally {
  await stopChild(child);
  log.end();
}
