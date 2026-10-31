import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Webpack 的 server runtime 用 `<runtime>.e(<id>)` 请求一个异步 chunk，
 * 再由 `webpack-runtime.js` 的 `k.f.require` 去 `require("./chunks/<id>.js")`。
 * 打包（`output: "standalone"` → `desktop-dist/server`）漏掉任何一个
 * `chunks/<id>.js`，引用它的路由模块就会在加载时报
 * `Cannot find module './chunks/<id>.js'`，Next 于是回一句纯文本
 * `500 Internal Server Error`——前端只能看到
 * `Unexpected token 'I', "Internal S"... is not valid JSON`。
 * 这里把这种“打包不完整”在构建期挡下来，别等用户点开面板才发现。
 */
const CHUNK_REQUEST = /[A-Za-z_$][\w$]*\.e\((\d+)\)/g;
/**
 * 同步挂载共享 chunk：`var c=b.X(0,[4741,1813,5582,4988],()=>b(b.s=85777))`。
 *
 * runtime 的 `k.X = (a,b,c)=>{ … b.map(k.e,k); … }` 会对数组里每个 id 调 `k.e(id)`，
 * 最终同样落到 `require("./chunks/<id>.js")`。webpack 用这种形式把路由入口与共享 chunk
 * 一起同步加载，所以（从 Next 16 起）**几乎每个路由 bundle 都长这样，而不是 `.e(4741)` 字面量**。
 * 只匹配 `.e(<id>)` 时整批共享 chunk 都不在检查范围内：CI 在 `win-x64` 上就是
 * `chunks/4988.js`（只有 `api/git` 用到）没被复制、也没被发现，服务能起来，
 * 但 `/api/git` 一加载就回纯文本 500。
 */
const SYNC_CHUNK_REQUEST = /[A-Za-z_$][\w$]*\.X\(\d+,\[([\d,\s]+)\]/g;

/** 递归列出 `.next/server` 下的所有 `.js` bundle。 */
export async function listServerBundles(directory) {
  const bundles = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) bundles.push(...await listServerBundles(path));
    else if (entry.isFile() && entry.name.endsWith(".js")) bundles.push(path);
  }
  return bundles;
}

/**
 * runtime 自己标记为“已加载”的 chunk id：这些 id 本来就没有对应文件。
 * 两处来源：一个 `{<id>:1}` 的已加载表，以及 `require("./chunks/…")` 旁那个
 * `<id>!=a ?` 的特例判断。变量名是压缩后的，所以只匹配形状不匹配名字。
 */
export function preloadedChunkIds(runtimeSource) {
  const ids = new Set();
  for (const match of runtimeSource.matchAll(/\{([\d:,\s]+)\}/g)) {
    for (const entry of match[1].split(",")) {
      const id = entry.split(":")[0].trim();
      if (id) ids.add(id);
    }
  }
  const specialCase = /(\d+)\s*!=\s*[A-Za-z_$]/.exec(runtimeSource);
  if (specialCase) ids.add(specialCase[1]);
  return ids;
}

/** 从一份 bundle 源码里收集它请求的 chunk id（含 `X(0,[…])` 形式的共享 chunk）。 */
export function chunkRequests(source) {
  const ids = new Set([...source.matchAll(CHUNK_REQUEST)].map((match) => match[1]));
  for (const match of source.matchAll(SYNC_CHUNK_REQUEST)) {
    for (const entry of match[1].split(",")) {
      const id = entry.trim();
      if (id) ids.add(id);
    }
  }
  return ids;
}

/**
 * 返回缺失的 chunk：`[{ id, files }]`，`files` 是引用它的 bundle 相对路径。
 * @param {string} serverDirectory `.next/server`（打包后即 `runtime/server/.next/server`）
 */
export async function findMissingServerChunks(serverDirectory) {
  const runtimePath = join(serverDirectory, "webpack-runtime.js");
  const runtimeSource = await readFile(runtimePath, "utf8");
  const preloaded = preloadedChunkIds(runtimeSource);

  let available = [];
  try {
    available = await readdir(join(serverDirectory, "chunks"));
  } catch {
    // 目录整体缺失时下面的循环会把每个引用都报出来。
  }
  const present = new Set(available.filter((name) => name.endsWith(".js")).map((name) => name.slice(0, -3)));

  const missing = new Map();
  for (const bundle of await listServerBundles(serverDirectory)) {
    if (bundle === runtimePath) continue;
    const source = await readFile(bundle, "utf8");
    for (const id of chunkRequests(source)) {
      if (present.has(id) || preloaded.has(id)) continue;
      const relative = bundle.slice(serverDirectory.length + 1);
      const files = missing.get(id) ?? [];
      files.push(relative);
      missing.set(id, files);
    }
  }
  return [...missing].map(([id, files]) => ({ id, files: files.sort() }));
}

/**
 * 用构建输出（`.next/server`）补齐 standalone 里缺失的 chunk。
 *
 * `output: "standalone"` 只按 nft 追踪出的 `files` 列表复制 `chunks/`，Windows 上实测
 * 会漏掉被异步引用的 chunk（`app/api/files/[...path]/route.js` 引用的那个就是）。
 * 同一次构建里 `.next/server/chunks` 与 standalone 里的同名 chunk 是逐字节相同的，
 * 所以从源头补缺失的文件不会换上另一份内容；已存在的文件一律不动。
 *
 * 返回 `{ restored, unresolved }`：`restored` 是补回来的，`unresolved` 是源头也没有的
 * （那种情况说明构建本身有问题，交给调用方报错）。
 * @param {string} serverDirectory 打包后的 `.next/server`
 * @param {string} sourceDirectory 构建输出的 `.next/server`
 */
export async function backfillMissingServerChunks(serverDirectory, sourceDirectory) {
  const missing = await findMissingServerChunks(serverDirectory);
  const restored = [];
  const unresolved = [];
  for (const entry of missing) {
    const source = join(sourceDirectory, "chunks", `${entry.id}.js`);
    const destination = join(serverDirectory, "chunks", `${entry.id}.js`);
    try {
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(source, destination);
      restored.push(entry);
    } catch {
      unresolved.push(entry);
    }
  }
  return { restored, unresolved };
}

/**
 * 读取一次构建的 `BUILD_ID`；没有该文件（目录整体缺失）时返回 `null`。
 * @param {string} nextDirectory `.next`（构建输出）或 `.next/standalone/.next`（打包的那份）
 */
export async function readBuildId(nextDirectory) {
  try {
    return (await readFile(join(nextDirectory, "BUILD_ID"), "utf8")).trim() || null;
  } catch {
    return null;
  }
}

/**
 * standalone 与构建输出是否同一次构建。
 *
 * 不同意味着 `.next` 已经被另一个构建目标覆盖过（实测：`desktop:prepare:frontend` 的静态导出
 * 会把 `.next/server` 换成导出版——BUILD_ID 变了、`app/api` 整棵消失、chunks 少 16 个），
 * 此时从 `.next/server/chunks` 补 chunk 拿到的是另一份构建的文件，报错只说「源头也没有」
 * 会把人引向错误的结论。返回一段可直接打印的说明，一致时返回 `null`。
 */
export function describeBuildIdMismatch(standaloneBuildId, sourceBuildId) {
  if (!standaloneBuildId || !sourceBuildId || standaloneBuildId === sourceBuildId) return null;
  return [
    `打包的 standalone（BUILD_ID ${standaloneBuildId}）与 .next（BUILD_ID ${sourceBuildId}）不是同一次构建：`,
    "`.next` 已被另一个构建目标覆盖（最可能是 `desktop:prepare:frontend` 的静态导出），",
    "所以 `.next/server/chunks` 里已经找不到 standalone 引用的那些 chunk。",
    "重新构建前先清干净：",
    "  rm -rf .next .next-desktop-frontend desktop-dist && npm run desktop:prepare",
  ].join("\n");
}

/** 缺失 chunk 的统一报错文案，构建脚本与冒烟测试共用。 */
export function describeMissingServerChunks(missing, serverDirectory) {
  const lines = missing.slice(0, 10).map(({ id, files }) => `  - chunks/${id}.js（被 ${files.slice(0, 3).join(", ")}${files.length > 3 ? " 等" : ""} 引用）`);
  const more = missing.length > 10 ? `\n  …以及另外 ${missing.length - 10} 个` : "";
  return [
    `${serverDirectory} 缺少 ${missing.length} 个 webpack chunk，这个 bundle 装到用户机器上会以「Internal Server Error」的形式失败：`,
    ...lines,
    more,
    "要么 .next 里残留了上一次构建的产物，要么 standalone 的复制漏了文件（源头 .next/server/chunks 里也没有这些 id）。",
    "清掉后重新构建：",
    "  rm -rf .next .next-desktop-frontend desktop-dist && npm run desktop:prepare",
  ].filter(Boolean).join("\n");
}
