import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  backfillMissingServerChunks,
  chunkRequests,
  describeBuildIdMismatch,
  describeMissingServerChunks,
  findMissingServerChunks,
  preloadedChunkIds,
  readBuildId,
} from "../scripts/server-chunk-check.mjs";

test("collects async chunk requests from a compiled server bundle", () => {
  const source = String.raw`async function d(){let{a}=await c.e(8554).then(c.bind(c,8554)),{b}=await c.e(2349).then(c.bind(c,42349))}`;
  assert.deepEqual([...chunkRequests(source)].sort(), ["2349", "8554"]);
});

test("ignores the runtime's own chunk-loading definition", () => {
  // `webpack-runtime.js` defines `k.e = ...`; that is not a request for a chunk.
  assert.deepEqual([...chunkRequests(`k.e=a=>{g[a]||(7311!=a?h(require("./chunks/"+k.u(a))))}`)], []);
});

test("reads the chunk ids the runtime marks as already loaded", () => {
  assert.deepEqual([...preloadedChunkIds(`k.p="/_next/",k.b=require("url"),g={7311:1},h=a=>{}`)], ["7311"]);
});

test("reports chunks referenced by a bundle but absent from chunks/", async (t) => {
  const server = await mkdtemp(join(tmpdir(), "pi-desktop-chunks-"));
  t.after(() => rm(server, { recursive: true, force: true }));
  await mkdir(join(server, "chunks"), { recursive: true });
  await mkdir(join(server, "app", "api", "git"), { recursive: true });
  await writeFile(join(server, "webpack-runtime.js"), `g={7311:1},h=a=>{}`);
  await writeFile(join(server, "chunks", "100.js"), "module.exports={}");
  // 100 存在、200 缺失、7311 由运行时预置，不应该被报告。
  await writeFile(join(server, "app", "api", "git", "route.js"), `c.e(100),c.e(200),c.e(7311);`);

  const missing = await findMissingServerChunks(server);
  assert.deepEqual(missing, [{ id: "200", files: [join("app", "api", "git", "route.js")] }]);
});

test("keeps the failure message actionable", () => {
  const message = describeMissingServerChunks([{ id: "4988", files: ["instrumentation.js"] }], "/tmp/server");
  assert.match(message, /chunks\/4988\.js/);
  assert.match(message, /instrumentation\.js/);
  assert.match(message, /Internal Server Error/);
  assert.match(message, /npm run desktop:prepare/);
});

test("restores chunks the standalone copy dropped and reports the ones it cannot", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-desktop-chunks-backfill-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "next-server");
  const packaged = join(root, "standalone-server");
  await mkdir(join(source, "chunks"), { recursive: true });
  await mkdir(join(packaged, "chunks"), { recursive: true });
  await mkdir(join(packaged, "app", "api", "files"), { recursive: true });
  // 3379 只在构建输出里、3379 之外的那个 9001 两边都没有。
  await writeFile(join(source, "chunks", "3379.js"), "module.exports={kind:'from-build'}");
  await writeFile(join(packaged, "webpack-runtime.js"), `g={7311:1},h=a=>{}`);
  await writeFile(join(packaged, "chunks", "100.js"), "module.exports={}");
  await writeFile(join(packaged, "app", "api", "files", "route.js"), `c.e(100),c.e(3379),c.e(9001);`);

  const { restored, unresolved } = await backfillMissingServerChunks(packaged, source);
  const route = join("app", "api", "files", "route.js");
  assert.deepEqual(restored, [{ id: "3379", files: [route] }]);
  assert.deepEqual(unresolved, [{ id: "9001", files: [route] }]);
  assert.equal(await readFile(join(packaged, "chunks", "3379.js"), "utf8"), "module.exports={kind:'from-build'}");
  // 已存在的 chunk 不被覆盖。
  assert.deepEqual(await findMissingServerChunks(packaged), [{ id: "9001", files: [route] }]);
});

test("leaves an already complete bundle untouched", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-desktop-chunks-complete-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "next-server");
  const packaged = join(root, "standalone-server");
  await mkdir(join(source, "chunks"), { recursive: true });
  await mkdir(join(packaged, "chunks"), { recursive: true });
  await mkdir(join(packaged, "app"), { recursive: true });
  await writeFile(join(source, "chunks", "3379.js"), "source");
  await writeFile(join(packaged, "chunks", "3379.js"), "packaged");
  await writeFile(join(packaged, "webpack-runtime.js"), `g={},h=a=>{}`);
  await writeFile(join(packaged, "app", "route.js"), `c.e(3379);`);

  const { restored, unresolved } = await backfillMissingServerChunks(packaged, source);
  assert.deepEqual(restored, []);
  assert.deepEqual(unresolved, []);
  assert.equal(await readFile(join(packaged, "chunks", "3379.js"), "utf8"), "packaged");
});

test("reads BUILD_ID from a build directory and tolerates a missing one", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-desktop-build-id-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "BUILD_ID"), "abc123\n");
  assert.equal(await readBuildId(root), "abc123");
  assert.equal(await readBuildId(join(root, "missing")), null);
});

test("stays quiet when the packaged bundle comes from the same build", () => {
  assert.equal(describeBuildIdMismatch("abc123", "abc123"), null);
  // 任一侧读不到 BUILD_ID 时不做判断，避免把“没有该文件”当成“被覆盖”。
  assert.equal(describeBuildIdMismatch(null, "abc123"), null);
  assert.equal(describeBuildIdMismatch("abc123", null), null);
});

test("explains a .next that another build target overwrote", () => {
  const message = describeBuildIdMismatch("standalone-id", "export-id");
  assert.match(message, /BUILD_ID standalone-id/);
  assert.match(message, /BUILD_ID export-id/);
  assert.match(message, /desktop:prepare:frontend/);
  assert.match(message, /rm -rf \.next \.next-desktop-frontend desktop-dist && npm run desktop:prepare/);
});
