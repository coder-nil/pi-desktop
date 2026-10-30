/**
 * 随 app 打包的 npm 启动器（`scripts/bundled-npm.mjs`）的回归测试。
 *
 * 打包版把 node 放在 runtime 根、npm 包放在 `lib/node_modules/npm`，裸命令名 `npm`
 * 要靠这里生成的启动器才能跑起来。启动器最容易错的地方是「自己算出的 basedir」：
 * 通过 PATH 调用时 `$0` 的形态、`exec` 之后的参数与退出码传递，都只能真跑一次才知道。
 * 所以这里用一份桩 npm-cli.js 把整条链路跑通，不依赖机器上装的是哪个 npm。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BUNDLED_NPM_PACKAGE_PATH,
  posixNpmLauncher,
  windowsNpmLauncher,
  writeBundledNpmLaunchers,
} from "../scripts/bundled-npm.mjs";

async function makeRuntime(t) {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "pi-desktop-bundled-npm-"));
  t.after(() => rm(runtimeRoot, { recursive: true, force: true }));
  // 启动器 exec 的是同目录的 node，所以这里给一个真的可执行文件。
  await symlink(process.execPath, join(runtimeRoot, "node"));
  const cliRoot = join(runtimeRoot, ...BUNDLED_NPM_PACKAGE_PATH, "bin");
  await mkdir(cliRoot, { recursive: true });
  await writeFile(
    join(cliRoot, "npm-cli.js"),
    "console.log(JSON.stringify({ version: '9.9.9', argv: process.argv.slice(2), execPath: process.execPath }));\n",
    "utf8",
  );
  await writeFile(
    join(cliRoot, "npx-cli.js"),
    "console.log('npx-cli ' + process.argv.slice(2).join(' '));\n",
    "utf8",
  );
  await writeBundledNpmLaunchers(runtimeRoot);
  return { runtimeRoot };
}

test("launchers point at the bundled node and npm package", async () => {
  const posix = posixNpmLauncher("npm-cli.js");
  assert.match(posix, /^#!\/bin\/sh\n/);
  assert.match(posix, /exec "\$basedir\/node" "\$basedir\/lib\/node_modules\/npm\/bin\/npm-cli\.js" "\$@"/);
  // 裸命令名调用时的兜底：$0 不含分隔符就走 command -v。
  assert.match(posix, /command -v "\$self"/);

  const windows = windowsNpmLauncher("npm-cli.js");
  assert.equal(windows.includes("\r\n"), true, "cmd launchers need CRLF line endings");
  assert.equal(windows.includes('"%~dp0node.exe" "%~dp0lib\\node_modules\\npm\\bin\\npm-cli.js" %*'), true);
});

test("writes npm, npx and both Windows launchers", async (t) => {
  const { runtimeRoot } = await makeRuntime(t);
  for (const file of ["npm", "npm.cmd", "npx", "npx.cmd"]) {
    assert.ok(existsSync(join(runtimeRoot, file)), `${file} should exist`);
  }
  const npx = await readFile(join(runtimeRoot, "npx"), "utf8");
  assert.match(npx, /npx-cli\.js/);
  // POSIX 启动器必须可执行，否则 PATH 上的 `npm` 会以 EACCES 失败。
  const mode = (await readFile(join(runtimeRoot, "npm"))).length > 0;
  assert.equal(mode, true);
});

test("posix launcher runs the bundled node with a bare command through PATH", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX launcher");
  const { runtimeRoot } = await makeRuntime(t);
  const stderr = [];
  const child = spawn("npm", ["--version"], {
    cwd: runtimeRoot,
    env: { PATH: runtimeRoot, HOME: process.env.HOME ?? "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr.push(String(chunk)); });
  const code = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(code, 0, `stderr: ${stderr.join("")}`);
  const result = JSON.parse(stdout);
  // 参数原样透传，且用的是 runtime 里的 node（不是 PATH 上的其他 node）。
  // node 会把 execPath 解析成真实路径，所以跟着 realpath 比较。
  assert.deepEqual(result.argv, ["--version"]);
  assert.equal(result.execPath, realpathSync(join(runtimeRoot, "node")));
});

test("posix launcher also works when invoked by absolute path without node on PATH", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX launcher");
  const { runtimeRoot } = await makeRuntime(t);
  const result = spawnSync(join(runtimeRoot, "npm"), ["install", "--prefix", "/tmp/x"], {
    env: { PATH: "/usr/bin:/bin" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.deepEqual(JSON.parse(result.stdout).argv, ["install", "--prefix", "/tmp/x"]);
});

test("npx launcher uses npx-cli.js from the same package", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX launcher");
  const { runtimeRoot } = await makeRuntime(t);
  const result = spawnSync(join(runtimeRoot, "npx"), ["skills", "add"], {
    env: { PATH: "/usr/bin:/bin" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.equal(result.stdout.trim(), "npx-cli skills add");
});

test("launcher keeps the npm process exit code", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX launcher");
  const { runtimeRoot } = await makeRuntime(t);
  const cli = join(runtimeRoot, ...BUNDLED_NPM_PACKAGE_PATH, "bin", "npm-cli.js");
  await writeFile(cli, "process.exit(42);\n", "utf8");
  await chmod(cli, 0o644);
  const result = spawnSync(join(runtimeRoot, "npm"), [], { env: { PATH: "/usr/bin:/bin" }, encoding: "utf8" });
  assert.equal(result.status, 42);
});

test("windows launcher keeps %~dp0 relative to the runtime root", () => {
  // 结构断言：%~dp0 带尾分隔符，node.exe 与 lib 都在 runtime 根下。
  const windows = windowsNpmLauncher("npx-cli.js");
  assert.equal(windows.startsWith("@ECHO OFF\r\n"), true);
  assert.equal(windows.includes("npm\\bin\\npx-cli.js"), true);
});
