import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { DELETE } = await jiti.import("./route.ts");

function createAgentDir(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-desktop-models-delete-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeFixture(agentDir) {
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({
    providers: {
      "0w0": {
        api: "openai-completions",
        baseUrl: "https://0w0.example.test/v1",
        models: [{ id: "model-a" }, { id: "model-b" }],
        modelOverrides: {
          "model-a": { reasoning: true },
          "model-b": { reasoning: false },
        },
      },
      keep: {
        api: "openai-completions",
        models: [{ id: "keep-model" }],
      },
    },
  }, null, 2));
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
    enabledModels: [
      "0w0/*",
      "0w0/model-a:high",
      "keep/keep-model",
    ],
  }, null, 2));
}

async function deleteModelConfig(body) {
  return DELETE(new Request("http://127.0.0.1/api/models-config", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

test("deleting a provider removes it from models.json and enabledModels", async (t) => {
  const agentDir = createAgentDir(t);
  writeFixture(agentDir);

  const response = await deleteModelConfig({ kind: "provider", provider: "0w0" });
  assert.equal(response.status, 200);

  const models = readJson(join(agentDir, "models.json"));
  assert.deepEqual(Object.keys(models.providers), ["keep"]);
  assert.deepEqual(readJson(join(agentDir, "settings.json")).enabledModels, [
    "keep/keep-model",
  ]);
});

test("deleting a model also removes its override and exact scope pattern", async (t) => {
  const agentDir = createAgentDir(t);
  writeFixture(agentDir);

  const response = await deleteModelConfig({ kind: "model", provider: "0w0", modelId: "model-a" });
  assert.equal(response.status, 200);

  const models = readJson(join(agentDir, "models.json"));
  assert.deepEqual(models.providers["0w0"].models, [{ id: "model-b" }]);
  assert.deepEqual(models.providers["0w0"].modelOverrides, {
    "model-b": { reasoning: false },
  });
  assert.deepEqual(readJson(join(agentDir, "settings.json")).enabledModels, [
    "0w0/*",
    "keep/keep-model",
  ]);
});
