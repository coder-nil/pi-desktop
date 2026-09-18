import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { maskApiKey } = await jiti.import("./api-key-mask.ts");

test("masks a key with the same number of characters as the original", () => {
  const key = "sk-abcdefghijklmnopqrstuvwxyz0123456789-4f2a";
  const masked = maskApiKey(key);

  assert.equal(masked.length, key.length);
  assert.equal(masked, `${"•".repeat(key.length - 4)}4f2a`);
  assert.ok(!masked.includes("abcdefg"));
});

test("keeps only the last four characters", () => {
  const key = "sk-abcdefghijklmnop4f2a";
  assert.equal(maskApiKey(key), `${"•".repeat(key.length - 4)}4f2a`);
});

test("hides short keys completely while keeping their length", () => {
  // 短 Key 露出末四位就等于泄了大部分内容，但长度仍要看得出来。
  assert.equal(maskApiKey("sk-1234"), "•".repeat(7));
  assert.equal(maskApiKey("0123456789a"), "•".repeat(11));
});

test("returns null when there is nothing to mask", () => {
  assert.equal(maskApiKey(undefined), null);
  assert.equal(maskApiKey(null), null);
  assert.equal(maskApiKey(""), null);
  assert.equal(maskApiKey("   "), null);
});

test("trims whitespace before masking", () => {
  const key = "sk-abcdefghijklmnop9z8y";
  assert.equal(maskApiKey(`  ${key}  `), `${"•".repeat(key.length - 4)}9z8y`);
});
