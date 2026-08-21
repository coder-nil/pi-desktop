import { access, rename, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiDirectory = join(root, "app", "api");
const parkedApiDirectory = join(root, `.desktop-api-${process.pid}`);
const proxyFile = join(root, "proxy.ts");
const parkedProxyFile = join(root, `.desktop-proxy-${process.pid}.ts`);

function run(command, arguments_, environment) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, arguments_, { cwd: root, env: environment, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`Desktop frontend build ${signal ? `was stopped by ${signal}` : `failed with exit code ${code}`}.`));
    });
  });
}

await access(apiDirectory);
await access(proxyFile);
await rm(parkedApiDirectory, { recursive: true, force: true });
await rm(parkedProxyFile, { force: true });
await rename(apiDirectory, parkedApiDirectory);
await rename(proxyFile, parkedProxyFile);
try {
  await run(process.execPath, ["node_modules/next/dist/bin/next", "build", "--webpack"], {
    ...process.env,
    PI_WEB_BUILD_TARGET: "desktop-frontend",
  });
} finally {
  await rename(parkedProxyFile, proxyFile);
  await rename(parkedApiDirectory, apiDirectory);
}
