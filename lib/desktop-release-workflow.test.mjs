import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { load } from "js-yaml";

const workflowPath = new URL("../.github/workflows/desktop.yml", import.meta.url);

async function loadBuildSteps() {
  const workflow = load(await readFile(workflowPath, "utf8"));
  return workflow.jobs.build.steps;
}

async function loadWorkflow() {
  return load(await readFile(workflowPath, "utf8"));
}

test("macOS releases use certificate-free ad-hoc signing", async () => {
  const steps = await loadBuildSteps();
  const nestedSigning = steps.find((step) => step.name === "Ad-hoc sign embedded Node runtime");
  const build = steps.find((step) => step.name === "Build ad-hoc signed macOS bundle");

  assert.match(nestedSigning.run, /codesign[\s\S]*--options runtime[\s\S]*--sign -[\s\S]*desktop-dist\/node/);
  assert.match(nestedSigning.run, /--entitlements src-tauri\/entitlements\.plist/);
  assert.equal(build.env.APPLE_SIGNING_IDENTITY, "-");
  assert.equal(JSON.stringify(steps).includes("secrets.APPLE_"), false);
});

test("macOS ARM64 releases smoke test the embedded Node runtime", async () => {
  const workflow = await loadWorkflow();
  const arm = workflow.jobs.build.strategy.matrix.include.find((entry) => entry.artifact === "macos-arm64");
  assert.equal(arm.smoke_with_system_node, false);

  const signedSmoke = workflow.jobs.build.steps.find((step) => step.name === "Smoke test signed embedded Node runtime");
  assert.match(signedSmoke.run, /npm run desktop:smoke/);
  assert.match(signedSmoke.if, /!matrix\.smoke_with_system_node/);
});

test("macOS releases verify the app both before and after DMG packaging", async () => {
  const steps = await loadBuildSteps();
  const verification = steps.find((step) => step.name === "Verify macOS bundle integrity");
  const helper = steps.find((step) => step.name === "Add macOS startup repair helper to DMG");

  assert.equal(helper.if, "runner.os == 'macOS'");
  assert.match(helper.run, /bash scripts\/add-macos-dmg-helper\.sh "\$dmg_path"/);
  assert.ok(steps.indexOf(helper) > steps.findIndex((step) => step.name === "Build ad-hoc signed macOS bundle"));
  assert.ok(steps.indexOf(helper) < steps.indexOf(verification));
  assert.match(verification.run, /test -x "\$mount_point\/Fix Pi Desktop\.command"/);
  assert.match(verification.run, /cmp "scripts\/macos\/Fix Pi Desktop\.command"/);

  assert.match(verification.run, /codesign --verify --deep --strict/);
  assert.match(verification.run, /Signature=adhoc/);
  assert.match(verification.run, /embedded_node[\s\S]*embedded Node startup OK/);
  assert.match(verification.run, /com\.apple\.security\.cs\.allow-jit/);
  assert.match(verification.run, /hdiutil attach/);
  assert.match(verification.run, /mount_point\/Pi Desktop\.app/);
  assert.match(verification.run, /DMG embedded Node startup OK/);
  assert.match(verification.run, /shasum -a 256/);

  const releaseFiles = steps.length > 0
    ? (await load(await readFile(workflowPath, "utf8"))).jobs.release.steps
      .find((step) => step.name === "Publish release").with.files
    : "";
  assert.match(releaseFiles, /SHA256SUMS-\*\.txt/);
});

test("the startup failure page is included as a public desktop asset", async () => {
  const startupPage = await readFile(new URL("../public/desktop-startup-error.html", import.meta.url), "utf8");
  assert.match(startupPage, /__PI_WEB_STARTUP_ERROR__/);
  assert.match(startupPage, /Pi Desktop could not start/);
});
