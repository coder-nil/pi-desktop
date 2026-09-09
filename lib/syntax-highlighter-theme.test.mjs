import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { darkSyntaxTheme, lightSyntaxTheme } = await jiti.import("./syntax-highlighter-theme.ts");
const preSelector = 'pre[class*="language-"]';

test("syntax themes use one non-conflicting background property", () => {
  for (const theme of [lightSyntaxTheme, darkSyntaxTheme]) {
    assert.equal("background" in theme[preSelector], false);
    assert.equal(typeof theme[preSelector].backgroundColor, "string");
  }
});
