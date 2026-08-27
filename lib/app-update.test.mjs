import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  compareVersions,
  getPiDesktopReleaseUrl,
  isNewerVersion,
  normalizeVersion,
} = await jiti.import("./app-update.ts");

test("detects newer stable and prerelease Pi Desktop versions", () => {
  assert.equal(isNewerVersion("0.8.8", "0.8.7"), true);
  assert.equal(isNewerVersion("0.9.0", "0.8.7"), true);
  assert.equal(isNewerVersion("1.0.0", "0.9.9"), true);
  assert.equal(isNewerVersion("0.84.2-alpha.2", "0.84.2-alpha.1"), true);
  assert.equal(isNewerVersion("0.84.2", "0.84.2-aphla.9"), true);
});

test("does not report equal, older, or invalid versions as updates", () => {
  assert.equal(isNewerVersion("0.8.7", "0.8.7"), false);
  assert.equal(isNewerVersion("0.8.6", "0.8.7"), false);
  assert.equal(isNewerVersion("0.8.8-beta.1", "0.8.8"), false);
  assert.equal(isNewerVersion("invalid", "0.8.7"), false);
  assert.equal(isNewerVersion("0.8.8-alpha.01", "0.8.7"), false);
});

test("uses SemVer prerelease precedence", () => {
  assert.equal(compareVersions("1.0.0-alpha.10", "1.0.0-alpha.2"), 1);
  assert.equal(compareVersions("1.0.0-alpha.beta", "1.0.0-alpha.1"), 1);
  assert.equal(compareVersions("1.0.0-alpha", "1.0.0-alpha.1"), -1);
  assert.equal(compareVersions("v1.0.0+build.2", "1.0.0+build.1"), 0);
});

test("normalizes tags and builds this repository's release URL", () => {
  assert.equal(normalizeVersion("v0.84.2-alpha.2"), "0.84.2-alpha.2");
  assert.equal(
    getPiDesktopReleaseUrl("0.84.2-alpha.2"),
    "https://github.com/mafousoftware/pi-desktop/releases/tag/v0.84.2-alpha.2",
  );
  assert.equal(getPiDesktopReleaseUrl("invalid"), null);
});
