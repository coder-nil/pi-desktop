import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const capability = JSON.parse(await readFile(new URL("./default.json", import.meta.url), "utf8"));

test("allows native notifications from the local desktop server only", () => {
  assert.deepEqual(capability.remote?.urls, ["http://127.0.0.1:*"]);
  assert.ok(capability.permissions.includes("notification:default"));
});

test("desktop capability grants every registered native command through the generated app manifest", async () => {
  // Run cargo check/test first to regenerate this manifest from build.rs.
  const manifests = JSON.parse(await readFile(new URL("../gen/schemas/acl-manifests.json", import.meta.url), "utf8"));
  const app = manifests["__app-acl__"];
  assert.ok(app, "custom commands need an app ACL manifest for the loopback dev origin");
  for (const command of ["hide_startup_overlay", "terminal_start", "terminal_write", "terminal_resize", "terminal_close", "open_release_url"]) {
    const permission = `allow-${command.replaceAll("_", "-")}`;
    assert.ok(capability.permissions.includes(permission), `missing grant for ${command}`);
    assert.ok(app.permissions[permission]?.commands.allow.includes(command), `missing command mapping for ${command}`);
  }
  assert.deepEqual(capability.windows, ["main"]);
  assert.deepEqual(capability.remote.urls, ["http://127.0.0.1:*"]);
});
