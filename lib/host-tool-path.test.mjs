/**
 * 打包版「安装/更新插件」报 `spawn npm ENOENT` 的回归测试。
 *
 * pi 的包管理器用裸命令名 `npm` spawn，只看 `process.env.PATH`；从 Dock 启动的
 * 打包版继承 launchd 最小 PATH，所以必须在服务端把真正存在 npm 的目录补回去。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { win32 } from "node:path";

// 通过 jiti 加载，模块内部的相对导入才按应用的方式解析（与 lib/file-access.test.mjs 一致）。
async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./host-tool-path.ts");
}

const LAUNCHD_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

/** 用一份「磁盘上有什么」的数据模拟文件系统，路径都用 posix 形态。 */
function fakeFs(files) {
  const known = new Set(files);
  return {
    isFile: (path) => known.has(path),
    files: known,
  };
}

test("already-resolvable npm leaves PATH untouched", async () => {
  const { planHostToolPath } = await loadSubject();
  const { isFile } = fakeFs(["/opt/homebrew/bin/npm"]);
  const plan = planHostToolPath({
    platform: "darwin",
    home: "/Users/tester",
    pathValue: "/opt/homebrew/bin:/usr/bin",
    runtimeDirectory: null,
    isFile,
    readDirectory: () => [],
  });
  assert.equal(plan.npmOnPath, "/opt/homebrew/bin/npm");
  assert.deepEqual(plan.directories, []);
});

test("launchd PATH picks up nvm newest version and Homebrew", async () => {
  const { planHostToolPath } = await loadSubject();
  const { isFile } = fakeFs([
    "/Users/tester/.nvm/versions/node/v22.19.0/bin/npm",
    "/Users/tester/.nvm/versions/node/v24.20.0/bin/npm",
    "/opt/homebrew/bin/npm",
    "/usr/bin/git",
  ]);
  const plan = planHostToolPath({
    platform: "darwin",
    home: "/Users/tester",
    pathValue: LAUNCHD_PATH,
    runtimeDirectory: null,
    isFile,
    readDirectory: (directory) =>
      directory === "/Users/tester/.nvm/versions/node" ? ["v18.20.8", "v22.19.0", "v24.20.0"] : [],
  });
  assert.equal(plan.npmOnPath, null);
  // 不存在的 v18.20.8 被过滤；同一个 nvm 只前置最新那个可用版本，再加 Homebrew。
  assert.deepEqual(plan.directories, [
    "/Users/tester/.nvm/versions/node/v24.20.0/bin",
    "/opt/homebrew/bin",
  ]);
});

test("falls through to an older version when the newest has no npm", async () => {
  const { planHostToolPath } = await loadSubject();
  const { isFile } = fakeFs(["/Users/tester/.nvm/versions/node/v22.19.0/bin/npm"]);
  const plan = planHostToolPath({
    platform: "darwin",
    home: "/Users/tester",
    pathValue: LAUNCHD_PATH,
    runtimeDirectory: null,
    isFile,
    readDirectory: () => ["v22.19.0", "v24.20.0"],
  });
  assert.deepEqual(plan.directories, ["/Users/tester/.nvm/versions/node/v22.19.0/bin"]);
});

test("directories already on PATH are not prepended twice", async () => {
  const { planHostToolPath } = await loadSubject();
  const { isFile } = fakeFs(["/usr/local/bin/npm"]);
  const plan = planHostToolPath({
    platform: "darwin",
    home: "/Users/tester",
    pathValue: `${LAUNCHD_PATH}:/usr/local/bin`,
    runtimeDirectory: null,
    isFile,
    readDirectory: () => [],
  });
  assert.equal(plan.npmOnPath, "/usr/local/bin/npm");
  assert.deepEqual(plan.directories, []);
});

test("windows looks for npm.cmd in the %APPDATA% npm prefix", async () => {
  const { npmExecutableNames, planHostToolPath } = await loadSubject();
  assert.deepEqual(npmExecutableNames("win32").slice(0, 1), ["npm.cmd"]);
  const env = {
    Path: "C:\\Windows\\system32;C:\\Windows",
    APPDATA: "C:\\Users\\tester\\AppData\\Roaming",
  };
  const { isFile } = fakeFs([win32.join(env.APPDATA, "npm", "npm.cmd")]);
  const plan = planHostToolPath({
    platform: "win32",
    home: "C:\\Users\\tester",
    env,
    pathValue: env.Path,
    runtimeDirectory: null,
    isFile,
    readDirectory: () => [],
  });
  assert.deepEqual(plan.directories, [win32.join(env.APPDATA, "npm")]);
});

test("versions sort newest first and non-version names last", async () => {
  const { compareNodeVersionsDescending } = await loadSubject();
  const sorted = ["v16.20.2", "v9.11.2", "v24.20.0", ".DS_Store"].sort(compareNodeVersionsDescending);
  assert.deepEqual(sorted, ["v24.20.0", "v16.20.2", "v9.11.2", ".DS_Store"]);
});

test("candidate directories cover version managers and package managers", async () => {
  const { candidateNodeBinDirectories } = await loadSubject();
  const candidates = candidateNodeBinDirectories({
    platform: "darwin",
    home: "/Users/tester",
    pathValue: LAUNCHD_PATH,
    runtimeDirectory: null,
    isFile: () => false,
    readDirectory: (directory) =>
      directory.endsWith("node-versions") || directory.endsWith(".nvm/versions/node") ? ["v24.20.0"] : [],
  });
  assert.ok(candidates.includes("/Users/tester/.nvm/versions/node/v24.20.0/bin"));
  assert.ok(candidates.includes("/Users/tester/.local/share/fnm/node-versions/v24.20.0/installation/bin"));
  assert.ok(candidates.includes("/opt/homebrew/bin"));
  assert.ok(candidates.includes("/usr/local/bin"));
  assert.ok(candidates.includes("/Users/tester/.volta/bin"));
});

test("ensureHostToolPath prepends the discovered npm directory once", async () => {
  const { ensureHostToolPath, missingNpmHint, resetHostToolPathForTests } = await loadSubject();
  const originalPath = process.env.PATH;
  resetHostToolPathForTests();
  try {
    process.env.PATH = LAUNCHD_PATH;
    const probe = {
      platform: "darwin",
      home: "/Users/tester",
      pathValue: LAUNCHD_PATH,
      isFile: fakeFs(["/opt/homebrew/bin/npm"]).isFile,
      readDirectory: () => [],
    };
    const first = ensureHostToolPath(probe);
    assert.deepEqual(first.directories, ["/opt/homebrew/bin"]);
    assert.equal(process.env.PATH?.split(":")[0], "/opt/homebrew/bin");
    assert.ok(process.env.PATH?.endsWith(LAUNCHD_PATH));
    assert.equal(missingNpmHint(first), "");

    // 第二次调用直接复用缓存，不会再插一遍。
    const second = ensureHostToolPath(probe);
    assert.equal(second, first);
    assert.equal(process.env.PATH?.split(":").filter((entry) => entry === "/opt/homebrew/bin").length, 1);
  } finally {
    process.env.PATH = originalPath;
    resetHostToolPathForTests();
  }
});

test("missingNpmHint stays silent when npm was found anywhere", async () => {
  const { missingNpmHint } = await loadSubject();
  assert.equal(missingNpmHint({ platform: "darwin", npmOnPath: "/usr/local/bin/npm", directories: [] }), "");
  assert.equal(missingNpmHint({ platform: "darwin", npmOnPath: null, directories: ["/opt/homebrew/bin"] }), "");
  assert.match(missingNpmHint({ platform: "darwin", npmOnPath: null, directories: [] }), /npmCommand/);
});

test("the bundled runtime is only a last resort for npm", async () => {
  const { planHostToolPath } = await loadSubject();
  const runtime = "/Applications/Pi Desktop.app/Contents/Resources/runtime";

  // 系统里有 npm：打包的那一份不参与，装了 Node.js 的机器行为完全不变。
  const withSystemNpm = planHostToolPath({
    platform: "darwin",
    home: "/Users/tester",
    pathValue: LAUNCHD_PATH,
    runtimeDirectory: runtime,
    isFile: fakeFs(["/Users/tester/.nvm/versions/node/v24.20.0/bin/npm", `${runtime}/npm`]).isFile,
    readDirectory: () => ["v24.20.0"],
  });
  assert.deepEqual(withSystemNpm.directories, ["/Users/tester/.nvm/versions/node/v24.20.0/bin"]);

  // 彻底没有 Node.js 的机器：用打包的，并且 `node` 与 `npm` 一起出现在 PATH 上。
  const bundledOnly = planHostToolPath({
    platform: "darwin",
    home: "/Users/tester",
    pathValue: LAUNCHD_PATH,
    runtimeDirectory: runtime,
    isFile: fakeFs([`${runtime}/npm`, `${runtime}/node`]).isFile,
    readDirectory: () => [],
  });
  assert.deepEqual(bundledOnly.directories, [runtime]);

  // runtime 里没有启动器（开发态 / 残包）时不能把一个空目录当成兜底。
  const incompleteRuntime = planHostToolPath({
    platform: "darwin",
    home: "/Users/tester",
    pathValue: LAUNCHD_PATH,
    runtimeDirectory: runtime,
    isFile: fakeFs([`${runtime}/node`]).isFile,
    readDirectory: () => [],
  });
  assert.deepEqual(incompleteRuntime.directories, []);
});

test("the runtime directory comes from PI_DESKTOP_RUNTIME_DIR", async () => {
  const { planHostToolPath } = await loadSubject();
  const runtime = "/Applications/Pi Desktop.app/Contents/Resources/runtime";
  const plan = planHostToolPath({
    platform: "darwin",
    home: "/Users/tester",
    env: { PATH: LAUNCHD_PATH, PI_DESKTOP_RUNTIME_DIR: ` ${runtime} ` },
    pathValue: LAUNCHD_PATH,
    isFile: fakeFs([`${runtime}/npm`]).isFile,
    readDirectory: () => [],
  });
  assert.deepEqual(plan.directories, [runtime]);
});
