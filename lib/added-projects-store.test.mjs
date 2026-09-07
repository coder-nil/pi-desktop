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
  getSelectedProject,
  saveSelectedProject,
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

test("persists the last selected project in the database", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-desktop-selected-project-"));
  const databasePath = join(directory, "pi.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  assert.equal(getSelectedProject(databasePath), null);
  saveSelectedProject({ projectKey: "project:one", projectRoot: "/work/one" }, databasePath);
  assert.deepEqual(getSelectedProject(databasePath), {
    projectKey: "project:one",
    projectRoot: "/work/one",
  });
  saveSelectedProject({ projectKey: "project:two", projectRoot: "/work/two" }, databasePath);
  assert.deepEqual(getSelectedProject(databasePath), {
    projectKey: "project:two",
    projectRoot: "/work/two",
  });
});
