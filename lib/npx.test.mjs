import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { withNodeOnPath } = await jiti.import("./npx.ts");

test("prepends the node directory so npm exec launchers can find their interpreter", () => {
  const env = withNodeOnPath(
    { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
    ["/Users/test/.nvm/versions/node/v24.20.0/bin"],
    "darwin",
  );
  // 这是报错现场的 PATH：GUI 启动只给到系统目录，node 目录必须排在最前面。
  assert.equal(env.PATH, "/Users/test/.nvm/versions/node/v24.20.0/bin:/usr/bin:/bin:/usr/sbin:/sbin");
});

test("keeps the order given and deduplicates entries", () => {
  const env = withNodeOnPath(
    { PATH: "/usr/bin:/opt/homebrew/bin" },
    ["/opt/homebrew/bin", "/opt/homebrew/bin"],
    "darwin",
  );
  assert.equal(env.PATH, "/opt/homebrew/bin:/usr/bin");
});

test("drops empty or missing node directories", () => {
  const env = withNodeOnPath({ PATH: "/usr/bin" }, [undefined, "  ", ""], "darwin");
  assert.equal(env.PATH, "/usr/bin");
});

test("still writes a PATH when the inherited environment has none", () => {
  const env = withNodeOnPath({ HOME: "/home/test" }, ["/usr/local/bin"], "darwin");
  assert.equal(env.PATH, "/usr/local/bin");
  assert.equal(env.HOME, "/home/test");
});

test("merges every case variant of Path on Windows into one key", () => {
  // libuv 拒绝带两个仅大小写不同的 PATH 的环境块，所以 `Path` 必须被折叠掉。
  const env = withNodeOnPath(
    { Path: "C:\\Windows\\system32", PATH: "C:\\Windows" },
    ["C:\\Program Files\\nodejs"],
    "win32",
  );
  assert.equal(Object.keys(env).filter((name) => /^path$/i.test(name)).length, 1);
  // 顺序按环境块的键出现顺序，先 `Path` 后 `PATH`。
  assert.equal(env.Path, "C:\\Program Files\\nodejs;C:\\Windows\\system32;C:\\Windows");
  assert.equal(env.PATH, undefined);
});

test("uses semicolons as the delimiter on Windows", () => {
  const env = withNodeOnPath({ Path: "C:\\Windows" }, ["C:\\node"], "win32");
  assert.equal(env.Path, "C:\\node;C:\\Windows");
});
