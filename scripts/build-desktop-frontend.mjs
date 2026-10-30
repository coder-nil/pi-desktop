import { access, readdir, rename, rm } from "node:fs/promises";
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
// 每个构建目标有各自的 distDir（见 next.config.ts）：`.next-dev` / `.next-desktop-dev` /
// `.next-desktop-frontend`。tsconfig 把所有目标的 dev 类型都 include 了，所以这些目录一旦
// 留下来，就会拿旧路由表来检查当前（已经移走 API 和 /m 的）源码，报一堆 TS2307。
// `.next/dev` 不必单独清：整个 `.next` 在导出期间都被挪走了（见下）。
const devTypesDirectories = [
  join(root, ".next-desktop-dev", "dev"),
];
const nextOutputDirectory = join(root, ".next");
const desktopFrontendOutputDirectory = join(root, ".next-desktop-frontend");
/**
 * 导出期间把整个 `.next` 挪开，而不是只挪 `standalone` 和 `static`。
 *
 * 实测：`output: "export"` 这一次构建会把导出产物也写进默认的 `.next`——
 * `.next/server/app/api` 整棵消失、`.next/server/chunks` 少掉 19 个被路由异步引用的 chunk，
 * 也就是把 `npm run build` 那份 standalone 构建的 server 输出换成了导出版（macOS 实测复现）。
 * 之后 `prepare-desktop.mjs` 从 `.next/server/chunks` 补 standalone 漏复制的 chunk 就取不到东西，
 * Windows 上因此报「源头也没有」而中止打包（CI 上实测）。
 *
 * 所以这里把 `.next` 整体停车，构建结束后原样换回来；导出期间万一还有东西往 `.next` 里写，
 * 恢复时一并丢掉。`distDir` 各自独立，导出构建不需要这份内容。
 */
const parkedNextOutputDirectory = join(root, `.desktop-next-${process.pid}`);

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
await rm(parkedNextOutputDirectory, { recursive: true, force: true });
// The desktop build temporarily hides API routes. Remove stale dev route types
// so TypeScript does not resolve validator imports for those hidden routes.
for (const directory of devTypesDirectories) {
  await rm(directory, { recursive: true, force: true });
}
const parkedNext = await parkIfPresent(nextOutputDirectory, parkedNextOutputDirectory);
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
  // 导出构建往 `.next` 里留下的内容不属于 standalone 构建，整目录丢掉再换回原来那份。
  await rm(nextOutputDirectory, { recursive: true, force: true });
  if (parkedNext) await rename(parkedNextOutputDirectory, nextOutputDirectory);
}
