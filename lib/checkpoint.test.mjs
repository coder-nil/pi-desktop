import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { expireOtherCheckpoints } = await jiti.import("./checkpoint.ts");

test("expires checkpoints from other sessions and preserves the current session", async () => {
  const agentDir = await mkdtemp(path.join(os.tmpdir(), "pi-checkpoints-"));
  const previousAgentDir = process.env.PI_AGENT_DIR;
  process.env.PI_AGENT_DIR = agentDir;

  try {
    const checkpointRoot = path.join(agentDir, "checkpoints");
    const currentSession = "current/session";
    const currentDir = path.join(checkpointRoot, encodeURIComponent(currentSession));
    const oldDir = path.join(checkpointRoot, "old-session");
    await mkdir(currentDir, { recursive: true });
    await mkdir(oldDir, { recursive: true });
    await writeFile(path.join(currentDir, "current.json"), "current");
    await writeFile(path.join(oldDir, "old.json"), "old");
    await writeFile(path.join(checkpointRoot, "README"), "keep non-session entries");

    assert.equal(await expireOtherCheckpoints(currentSession), 1);
    assert.equal(await readFile(path.join(currentDir, "current.json"), "utf8"), "current");
    assert.equal(await readFile(path.join(checkpointRoot, "README"), "utf8"), "keep non-session entries");
    await assert.rejects(() => readFile(path.join(oldDir, "old.json"), "utf8"), { code: "ENOENT" });
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_AGENT_DIR;
    else process.env.PI_AGENT_DIR = previousAgentDir;
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("does nothing when the checkpoint root does not exist", async () => {
  const agentDir = await mkdtemp(path.join(os.tmpdir(), "pi-checkpoints-empty-"));
  const previousAgentDir = process.env.PI_AGENT_DIR;
  process.env.PI_AGENT_DIR = agentDir;

  try {
    assert.equal(await expireOtherCheckpoints("new-session"), 0);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_AGENT_DIR;
    else process.env.PI_AGENT_DIR = previousAgentDir;
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("new sessions expire checkpoints from other sessions", async () => {
  const source = await readFile(new URL("../app/api/agent/new/route.ts", import.meta.url), "utf8");

  assert.match(source, /await expireOtherCheckpoints\(realSessionId\)/);
});
