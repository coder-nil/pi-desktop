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
  setAddedProjectStarred,
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

test("lists starred projects first and keeps the star when a project is re-added", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-desktop-starred-projects-"));
  const databasePath = join(directory, "pi.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  saveAddedProject({ projectKey: "project:one", projectRoot: "/work/one", cwd: "/work/one" }, databasePath);
  saveAddedProject({ projectKey: "project:two", projectRoot: "/work/two", cwd: "/work/two" }, databasePath);
  saveAddedProject({ projectKey: "project:three", projectRoot: "/work/three", cwd: "/work/three" }, databasePath);
  assert.deepEqual(
    listAddedProjects(databasePath).map((project) => project.projectKey),
    ["project:three", "project:two", "project:one"],
  );

  assert.equal(setAddedProjectStarred("project:one", true, databasePath), true);
  assert.deepEqual(
    listAddedProjects(databasePath).map((project) => project.projectKey),
    ["project:one", "project:three", "project:two"],
  );
  assert.equal(listAddedProjects(databasePath)[0].starred, true);

  // Re-adding refreshes recency but is not a way to lose the star.
  saveAddedProject({ projectKey: "project:one", projectRoot: "/work/one", cwd: "/work/one" }, databasePath);
  assert.equal(listAddedProjects(databasePath)[0].starred, true);

  assert.equal(setAddedProjectStarred("project:one", false, databasePath), true);
  assert.deepEqual(
    listAddedProjects(databasePath).map((project) => project.projectKey),
    ["project:one", "project:three", "project:two"],
  );
  assert.equal(setAddedProjectStarred("project:missing", true, databasePath), false);
});

test("adds the starred column to a database written before starring existed", async (t) => {
  const { DatabaseSync } = await import("node:sqlite");
  const directory = await mkdtemp(join(tmpdir(), "pi-desktop-starred-migration-"));
  const databasePath = join(directory, "pi.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE added_projects (
      project_key TEXT PRIMARY KEY,
      project_root TEXT NOT NULL,
      cwd TEXT NOT NULL,
      added_at TEXT NOT NULL
    );
  `);
  legacy.prepare("INSERT INTO added_projects(project_key, project_root, cwd, added_at) VALUES (?, ?, ?, ?)")
    .run("project:legacy", "/work/legacy", "/work/legacy", new Date().toISOString());
  legacy.close();

  const projects = listAddedProjects(databasePath);
  assert.deepEqual(projects, [{
    projectKey: "project:legacy",
    projectRoot: "/work/legacy",
    cwd: "/work/legacy",
    addedAt: projects[0].addedAt,
    starred: false,
  }]);
  assert.equal(setAddedProjectStarred("project:legacy", true, databasePath), true);
  assert.equal(listAddedProjects(databasePath)[0].starred, true);
});
