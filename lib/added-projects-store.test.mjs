import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  listAddedProjects,
  removeAddedProject,
  saveAddedProject,
} = await jiti.import("./added-projects-store.ts");

test("persists manually added projects and removes only their database record", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-desktop-added-projects-"));
  const databasePath = join(directory, "pi.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  saveAddedProject({ projectKey: "project:one", projectRoot: "/work/one", cwd: "/work/one" }, databasePath);
  saveAddedProject({ projectKey: "project:two", projectRoot: "/work/two", cwd: "/work/two" }, databasePath);

  assert.deepEqual(
    listAddedProjects(databasePath).map((project) => project.projectKey),
    ["project:two", "project:one"],
  );
  assert.equal(removeAddedProject("project:one", databasePath), true);
  assert.deepEqual(
    listAddedProjects(databasePath).map((project) => project.projectRoot),
    ["/work/two"],
  );
});
