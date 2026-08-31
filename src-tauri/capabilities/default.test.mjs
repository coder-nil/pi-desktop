import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const capability = JSON.parse(await readFile(new URL("./default.json", import.meta.url), "utf8"));

test("allows native notifications from the local desktop server only", () => {
  assert.deepEqual(capability.remote?.urls, ["http://127.0.0.1:*"]);
  assert.ok(capability.permissions.includes("notification:default"));
});
