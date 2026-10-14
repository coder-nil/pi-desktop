import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { parseFileRenameName } = await jiti.import("./file-rename.ts");

test("normalizes a file rename name", () => {
  assert.equal(parseFileRenameName("  renamed.ts  "), "renamed.ts");
  assert.equal(parseFileRenameName(".env"), ".env");
});

test("rejects empty, traversal, separator, and null-byte names", () => {
  for (const value of [undefined, "", "   ", ".", "..", "a/b", "a\\b", "a\0b"]) {
    assert.equal(parseFileRenameName(value), null);
  }
});
