import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("checks for an application update when the shell mounts", () => {
  assert.match(source, /fetch\(`\/api\/app-update/);
  assert.match(source, /void checkAppUpdate\(true\)/);
});

test("shows the update button only for a newer release and opens GitHub", () => {
  assert.match(source, /appUpdate\?\.updateAvailable &&/);
  assert.match(source, /if \(window\.__PI_WEB_API_ORIGIN__\)/);
  assert.match(source, /invoke\("open_release_url", \{ url: appUpdate\.releaseUrl \}\)/);
  assert.match(source, /window\.location\.href = appUpdate\.releaseUrl/);
  assert.match(source, /window\.open\(appUpdate\.releaseUrl, "_blank", "noopener,noreferrer"\)/);
  assert.match(source, /onClick=\{openAppUpdate\}/);
});
