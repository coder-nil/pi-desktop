import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("full history navigates the desktop WebView to the loopback export URL", () => {
  const handler = source.slice(
    source.indexOf("  const handleViewFullHistory = useCallback"),
    source.indexOf("  // Show chat area"),
  );

  assert.match(handler, /if \(window\.__PI_WEB_API_ORIGIN__\)/);
  assert.match(handler, /window\.location\.href =/);
  assert.match(handler, /\$\{exportPath\}&desktop=1&returnTo=\$\{encodeURIComponent\(window\.location\.href\)\}/);
  assert.match(handler, /window\.open\(exportPath, "_blank", "noopener,noreferrer"\)/);
});
