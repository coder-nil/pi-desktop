import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { load } from "js-yaml";

const workflowPath = new URL("../.github/workflows/desktop.yml", import.meta.url);

async function loadBuildSteps() {
  const workflow = load(await readFile(workflowPath, "utf8"));
  return workflow.jobs.build.steps;
}

test("macOS releases use certificate-free ad-hoc signing", async () => {
  const steps = await loadBuildSteps();
  const nestedSigning = steps.find((step) => step.name === "Ad-hoc sign embedded Node runtime");
  const build = steps.find((step) => step.name === "Build ad-hoc signed macOS bundle");

  assert.match(nestedSigning.run, /codesign[\s\S]*--options runtime[\s\S]*--sign -[\s\S]*desktop-dist\/node/);
  assert.equal(build.env.APPLE_SIGNING_IDENTITY, "-");
  assert.equal(JSON.stringify(steps).includes("secrets.APPLE_"), false);
});

test("macOS releases verify the app both before and after DMG packaging", async () => {
  const steps = await loadBuildSteps();
  const verification = steps.find((step) => step.name === "Verify macOS bundle integrity");

  assert.match(verification.run, /codesign --verify --deep --strict/);
  assert.match(verification.run, /Signature=adhoc/);
  assert.match(verification.run, /hdiutil attach/);
  assert.match(verification.run, /mount_point\/Pi Desktop\.app/);
  assert.match(verification.run, /shasum -a 256/);

  const releaseFiles = steps.length > 0
    ? (await load(await readFile(workflowPath, "utf8"))).jobs.release.steps
      .find((step) => step.name === "Publish release").with.files
    : "";
  assert.match(releaseFiles, /SHA256SUMS-\*\.txt/);
});
