import assert from "node:assert/strict";
import test from "node:test";

const { isDesktopShell } = await import("./desktop-notifications.ts");

test("only enables native notifications in the Tauri desktop shell", () => {
  assert.equal(isDesktopShell({ __PI_WEB_DESKTOP__: true }), true);
  assert.equal(isDesktopShell({ __PI_WEB_DESKTOP__: false }), false);
  assert.equal(isDesktopShell(undefined), false);
});
