import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./layout.tsx", import.meta.url), "utf8");

test("desktop API URL rewrite keeps window.open target and features", () => {
  assert.match(
    source,
    /window\.open=function\(url,target,features\)\{return nativeOpen\.call\(window,rewrite\(String\(url\)\),target,features\)\}/,
  );
});
