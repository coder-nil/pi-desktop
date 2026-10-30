// bundled-npm.mjs - 生成随 app 打包的 npm / npx 启动器
//
// Node.js 官方发行包里本来就带 npm（`lib/node_modules/npm`，Windows 是
// `node_modules/npm`），而 `scripts/prepare-desktop.mjs` 以前只从 tarball 里拷了
// `bin/node` 一个文件。这里把那棵 npm 包放在 runtime 根下的固定位置，并生成两个
// 极小的启动器，让裸命令名 `npm` / `npx` 在 `PATH` 上能直接跑起来。
//
// 为什么不直接拷官方 `bin/npm`：那是相对官方布局的符号链接（或依赖
// `node.exe` 与 `node_modules` 同级的 Windows 脚本），把 node 拆到 runtime 根之后
// 就指不到 npm-cli.js 了。启动器自己算目录，只依赖 `node` 在同一个目录里。
//
// 不在 `lib/` 里：`lib/*.ts` 要经过 TypeScript，而 `node scripts/prepare-desktop.mjs`
// 是裸 node 跑的，导不进来。

import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** npm 包在 runtime 根下的位置（两个平台一致，方便排查）。 */
export const BUNDLED_NPM_PACKAGE_PATH = ["lib", "node_modules", "npm"];

/**
 * POSIX 启动器。
 *
 * 全部用 shell 内建能力（参数展开、`command -v`），**不调用 dirname/pwd**：
 * 从 Dock 启动的 Pi Desktop 的 PATH 可能只剩一个不相关的目录，而启动器自己
 * 必须是自包含的。通过 `PATH` 调用时 `$0` 已经是内核 shebang 传入的完整路径，
 * `command -v` 只在拿到裸命令名时傅底。`exec` 把参数和退出码直接交给 node，
 * 不给 npm 多套一层进程。
 */
export function posixNpmLauncher(cliFile = "npm-cli.js") {
  return `#!/bin/sh
# Pi Desktop 自带的 npm：用随 app 打包的 node 运行同一份 ${cliFile}。
self=$0
case "$self" in
  */*) ;;
  *)
    found=$(command -v "$self" 2>/dev/null) || found=$self
    self=$found
    ;;
esac
case "$self" in
  */*) basedir=\${self%/*} ;;
  *) basedir=. ;;
esac
if [ -z "$basedir" ]; then basedir=/; fi
exec "$basedir/node" "$basedir/lib/node_modules/npm/bin/${cliFile}" "$@"
`;
}

/** Windows 启动器：`%~dp0` 带尾分隔符，node.exe 就在同一目录。 */
export function windowsNpmLauncher(cliFile = "npm-cli.js") {
  return [
    "@ECHO OFF",
    `"%~dp0node.exe" "%~dp0lib\\node_modules\\npm\\bin\\${cliFile}" %*`,
    "",
  ].join("\r\n");
}

/**
 * 在 `directory` 里生成 `npm` / `npx` 的启动器。
 *
 * 两个平台的启动器都写：交叉打包（在 macOS 上出 win-x64 产物）时不必判断宿主平台，
 * 也不会因为漏写而让产物少一个入口。
 */
export async function writeBundledNpmLaunchers(directory) {
  const launchers = [
    ["npm", "npm-cli.js"],
    ["npx", "npx-cli.js"],
  ];
  for (const [name, cliFile] of launchers) {
    const posixPath = join(directory, name);
    await writeFile(posixPath, posixNpmLauncher(cliFile), "utf8");
    await chmod(posixPath, 0o755);
    await writeFile(join(directory, `${name}.cmd`), windowsNpmLauncher(cliFile), "utf8");
  }
}
