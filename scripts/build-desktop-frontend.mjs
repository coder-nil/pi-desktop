import { access, mkdir, rename, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiDirectory = join(root, "app", "api");
const parkedApiDirectory = join(root, `.desktop-api-${process.pid}`);
const proxyFile = join(root, "proxy.ts");
const parkedProxyFile = join(root, `.desktop-proxy-${process.pid}.ts`);
const devTypesDirectory = join(root, ".next", "dev");
const nextOutputDirectory = join(root, ".next");
const standaloneDirectory = join(nextOutputDirectory, "standalone");
const staticDirectory = join(nextOutputDirectory, "static");
const parkedStandaloneDirectory = join(root, `.desktop-standalone-${process.pid}`);
const parkedStaticDirectory = join(root, `.desktop-static-${process.pid}`);

async function parkIfPresent(source, destination) {
  try {
    await rename(source, destination);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

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
await rm(parkedStandaloneDirectory, { recursive: true, force: true });
await rm(parkedStaticDirectory, { recursive: true, force: true });
// The desktop build temporarily hides API routes. Remove stale dev route types
// so TypeScript does not resolve validator imports for those hidden routes.
await rm(devTypesDirectory, { recursive: true, force: true });
const parkedStandalone = await parkIfPresent(standaloneDirectory, parkedStandaloneDirectory);
const parkedStatic = await parkIfPresent(staticDirectory, parkedStaticDirectory);
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
  await mkdir(nextOutputDirectory, { recursive: true });
  if (parkedStandalone) {
    await rm(standaloneDirectory, { recursive: true, force: true });
    await rename(parkedStandaloneDirectory, standaloneDirectory);
  }
  if (parkedStatic) {
    await rm(staticDirectory, { recursive: true, force: true });
    await rename(parkedStaticDirectory, staticDirectory);
  }
}
