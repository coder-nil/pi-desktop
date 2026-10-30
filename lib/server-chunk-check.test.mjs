import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  chunkRequests,
  describeMissingServerChunks,
  findMissingServerChunks,
  preloadedChunkIds,
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
