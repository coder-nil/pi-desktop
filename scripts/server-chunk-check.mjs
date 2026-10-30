import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

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

/** 从一份 bundle 源码里收集它请求的 chunk id。 */
export function chunkRequests(source) {
  return new Set([...source.matchAll(CHUNK_REQUEST)].map((match) => match[1]));
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

/** 缺失 chunk 的统一报错文案，构建脚本与冒烟测试共用。 */
export function describeMissingServerChunks(missing, serverDirectory) {
  const lines = missing.slice(0, 10).map(({ id, files }) => `  - chunks/${id}.js（被 ${files.slice(0, 3).join(", ")}${files.length > 3 ? " 等" : ""} 引用）`);
  const more = missing.length > 10 ? `\n  …以及另外 ${missing.length - 10} 个` : "";
  return [
    `${serverDirectory} 缺少 ${missing.length} 个 webpack chunk，这个 bundle 装到用户机器上会以「Internal Server Error」的形式失败：`,
    ...lines,
    more,
    "通常是 .next / desktop-dist 里残留了上一次构建的产物。清掉后重新构建：",
    "  rm -rf .next .next-desktop-frontend desktop-dist && npm run desktop:prepare",
  ].filter(Boolean).join("\n");
}
