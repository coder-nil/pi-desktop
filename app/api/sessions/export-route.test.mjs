import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./[id]/export/route.ts", import.meta.url), "utf8");

test("desktop exports return to an approved conversation URL on Escape", () => {
  assert.match(source, /function addDesktopReturnHandler/);
  assert.match(source, /event\.key==="Escape"/);
  assert.match(source, /function getDesktopReturnUrl/);
  assert.match(source, /url\.protocol === "tauri:" && url\.hostname === "localhost"/);
  assert.match(source, /url\.protocol === "http:" && url\.hostname === "127\.0\.0\.1"/);
  assert.match(source, /location\.replace/);
  assert.match(source, /const desktop = searchParams\.get\("desktop"\) === "1"/);
  assert.match(source, /desktop\s*\? addDesktopReturnHandler\(patchExportHtml\(html\), desktopReturnUrl\)/);
});
