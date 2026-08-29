import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("development entrypoint enforces the supported Node.js version", async () => {
  const source = await readFile(new URL("../bin/pi-desktop-dev.js", import.meta.url), "utf8");

  assert.match(source, /require\("\.\/node-version"\)/);
  assert.match(source, /isNodeVersionSupported\(process\.versions\.node\)/);
});

test("desktop development uses an isolated Next.js output directory", async () => {
  const source = await readFile(new URL("../scripts/desktop-dev-supervisor.mjs", import.meta.url), "utf8");

  assert.match(source, /PI_WEB_BUILD_TARGET:\s*"desktop-dev"/);
});

test("development tooling ignores the isolated desktop output", async () => {
  const [gitignore, eslintConfig] = await Promise.all([
    readFile(new URL("../.gitignore", import.meta.url), "utf8"),
    readFile(new URL("../eslint.config.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(gitignore, /^\/\.next-desktop-dev\/$/m);
  assert.match(eslintConfig, /"\.next-desktop-dev\/\*\*"/);
});
