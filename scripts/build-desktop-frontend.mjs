import { access, mkdir, readdir, rename, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiDirectory = join(root, "app", "api");
const parkedApiDirectory = join(root, `.desktop-api-${process.pid}`);
const proxyFile = join(root, "proxy.ts");
const parkedProxyFile = join(root, `.desktop-proxy-${process.pid}.ts`);
// `/m` 读 `headers()` 判定手机来源，同时在两个构建目标下存在：真正的服务器由
// `npm run build`（standalone）产出，`/m` 在运行时由它渲染；这个静态导出只提供
// 桌面壳的壳资源，`/m` 属于死代码。留着它会让 `output: "export"` 去预渲染一个
// `dynamic = "force-dynamic"` 的页面并直接失败，所以和 API / proxy 一样挪走。
const mobilePageDirectory = join(root, "app", "m");
const parkedMobilePageDirectory = join(root, `.desktop-m-${process.pid}`);
const devTypesDirectory = join(root, ".next", "dev");
const nextOutputDirectory = join(root, ".next");
const standaloneDirectory = join(nextOutputDirectory, "standalone");
const staticDirectory = join(nextOutputDirectory, "static");
const desktopFrontendOutputDirectory = join(root, ".next-desktop-frontend");
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

/**
 * 静态导出不能包含依赖请求的路由。`/m` 是动态页面（`force-dynamic` + `headers()`），
 * 一旦被导出就报错中止，所以导出后确认它确实没有出现在产物里。这里只做“没有它”
 * 的断言，不猜测具体目录结构。
 */
async function assertMobilePageNotExported() {
  const offenders = [];
  for (const entry of await readdir(desktopFrontendOutputDirectory)) {
    if (entry === "m" || entry.startsWith("m.")) offenders.push(entry);
  }
  const serverDirectory = join(desktopFrontendOutputDirectory, "server");
  if (await exists(serverDirectory)) {
    for (const entry of await readdir(serverDirectory)) {
      if (entry === "m" || entry.startsWith("m.")) offenders.push(join("server", entry));
    }
  }
  if (offenders.length > 0) {
    throw new Error(`Desktop frontend export unexpectedly contains the dynamic /m route: ${offenders.join(", ")}`);
  }
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
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
await access(mobilePageDirectory);
await rm(parkedApiDirectory, { recursive: true, force: true });
await rm(parkedProxyFile, { force: true });
await rm(parkedMobilePageDirectory, { recursive: true, force: true });
await rm(parkedStandaloneDirectory, { recursive: true, force: true });
await rm(parkedStaticDirectory, { recursive: true, force: true });
// The desktop build temporarily hides API routes. Remove stale dev route types
// so TypeScript does not resolve validator imports for those hidden routes.
await rm(devTypesDirectory, { recursive: true, force: true });
const parkedStandalone = await parkIfPresent(standaloneDirectory, parkedStandaloneDirectory);
const parkedStatic = await parkIfPresent(staticDirectory, parkedStaticDirectory);
await rename(apiDirectory, parkedApiDirectory);
await rename(proxyFile, parkedProxyFile);
await rename(mobilePageDirectory, parkedMobilePageDirectory);
try {
  await run(process.execPath, ["node_modules/next/dist/bin/next", "build", "--webpack"], {
    ...process.env,
    PI_WEB_BUILD_TARGET: "desktop-frontend",
  });
  await assertMobilePageNotExported();
} finally {
  await rename(parkedProxyFile, proxyFile);
  await rename(parkedApiDirectory, apiDirectory);
  await rm(mobilePageDirectory, { recursive: true, force: true });
  await rename(parkedMobilePageDirectory, mobilePageDirectory);
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
