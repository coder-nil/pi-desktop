import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, PATCH } = await jiti.import("./route.ts");
const { saveAddedProject } = await jiti.import("../../../lib/added-projects-store.ts");

async function withAgentDir(t) {
  const agentDir = await mkdtemp(path.join(os.tmpdir(), "pi-desktop-projects-route-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    return rm(agentDir, { recursive: true, force: true });
  });
  return agentDir;
}

function patchRequest(body) {
  return new Request("http://localhost/api/projects", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("PATCH marks a project as starred and GET lists it first", async (t) => {
  const agentDir = await withAgentDir(t);
  const databasePath = path.join(agentDir, "pi.sqlite");
  saveAddedProject({ projectKey: "project:one", projectRoot: "/work/one", cwd: "/work/one" }, databasePath);
  saveAddedProject({ projectKey: "project:two", projectRoot: "/work/two", cwd: "/work/two" }, databasePath);

  const response = await PATCH(patchRequest({ projectKey: "project:one", starred: true }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, starred: true });

  const list = await (await GET()).json();
  assert.deepEqual(list.projects.map((project) => project.projectKey), ["project:one", "project:two"]);
  assert.deepEqual(list.projects.map((project) => project.starred), [true, false]);

  // Unstarring drops it back to the recency order.
  const cleared = await PATCH(patchRequest({ projectKey: "project:one", starred: false }));
  assert.equal(cleared.status, 200);
  assert.deepEqual(
    (await (await GET()).json()).projects.map((project) => project.projectKey),
    ["project:two", "project:one"],
  );
});

test("PATCH rejects an invalid body and an unknown project", async (t) => {
  await withAgentDir(t);

  assert.equal((await PATCH(patchRequest({ projectKey: "project:one" }))).status, 400);
  assert.equal((await PATCH(patchRequest({ starred: true }))).status, 400);
  assert.equal((await PATCH(patchRequest({ projectKey: "project:missing", starred: true }))).status, 404);
});
