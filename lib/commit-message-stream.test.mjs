import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./commit-message-stream.ts");
}

async function readEvents(response) {
  const text = await response.text();
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

test("streams update, done, and error events as newline-delimited JSON", async () => {
  const { streamCommitMessage } = await loadSubject();

  const ok = streamCommitMessage(async (onUpdate) => {
    onUpdate("feat: add");
    onUpdate("feat: add\n\n- a");
    return "feat: add\n\n- a";
  });
  assert.equal(ok.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
  assert.deepEqual(await readEvents(ok), [
    { type: "update", message: "feat: add" },
    { type: "update", message: "feat: add\n\n- a" },
    { type: "done", message: "feat: add\n\n- a" },
  ]);

  const failed = streamCommitMessage(async () => {
    throw new Error("model unavailable");
  });
  assert.deepEqual(await readEvents(failed), [{ type: "error", error: "model unavailable" }]);
});
