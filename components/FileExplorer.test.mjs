import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");

test("double-clicking a file or folder name starts inline rename", () => {
  assert.match(source, /onDoubleClick=\{\(event\) => \{[\s\S]*?startRename\(\);/);
  assert.match(source, /ref=\{renameInputRef\}[\s\S]*?aria-label=\{t\("i18n\.rename"\)\}/);
});

test("inline rename submits with PATCH and supports Enter and Escape", () => {
  assert.match(source, /method: "PATCH"/);
  assert.match(source, /body: JSON\.stringify\(\{ name \}\)/);
  assert.match(source, /event\.key === "Enter"[\s\S]*?event\.currentTarget\.blur\(\)/);
  assert.match(source, /event\.key === "Escape"[\s\S]*?cancelRename\(\)/);
});

test("rename protection covers files and folders with open descendants", () => {
  assert.match(source, /canRenamePath && !canRenamePath\(node\.fullPath\)/);
  assert.match(source, /t\("files\.renameUnsaved"\)/);
});
