import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { scanSessionFiles, resetSessionIndex } = await jiti.import("./session-index.ts");

function line(value) {
  return `${JSON.stringify(value)}\n`;
}

function sessionFile({ id = "s1", cwd = "/tmp/proj", timestamp = "2026-01-01T00:00:00.000Z", parentSession } = {}) {
  return { type: "session", version: 3, id, timestamp, cwd, ...(parentSession ? { parentSession } : {}) };
}

function message(id, role, content, timestamp) {
  return { type: "message", id, parentId: null, timestamp, message: { role, content } };
}

/** A temp `PI_CODING_AGENT_DIR` whose `sessions/<dir>/` holds the given files. */
function makeAgentDir(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-session-index-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  resetSessionIndex();
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    resetSessionIndex();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    write(relativeDir, fileName, content) {
      const dir = join(root, "sessions", relativeDir);
      mkdirSync(dir, { recursive: true });
      const filePath = join(dir, fileName);
      writeFileSync(filePath, content);
      return filePath;
    },
  };
}

test("summarises a transcript the way the sidebar needs it", async (t) => {
  const agent = makeAgentDir(t);
  agent.write(
    "--tmp-proj--",
    "s1.jsonl",
    line(sessionFile({ parentSession: "/tmp/parent.jsonl" }))
      + line(message("m1", "user", "hello there", "2026-01-01T00:00:01.000Z"))
      + line({ type: "model_change", id: "c1", parentId: "m1", timestamp: "2026-01-01T00:00:02.000Z", provider: "p", modelId: "m" })
      // Pi records the prompt as a system-role transcript message; it counts
      // toward messageCount (same rule as the SDK) but never becomes the preview.
      + line(message("m2", "system", "you are a coding agent", "2026-01-01T00:00:03.000Z"))
      + line(message("m3", "assistant", [{ type: "text", text: "hi" }], "2026-01-01T00:00:09.000Z"))
      + line({ type: "session_info", id: "i1", parentId: "m3", name: "  my session  " }),
  );

  const [summary, ...rest] = await scanSessionFiles();
  assert.equal(rest.length, 0);
  assert.equal(summary.id, "s1");
  assert.equal(summary.cwd, "/tmp/proj");
  assert.equal(summary.name, "my session");
  assert.equal(summary.messageCount, 3);
  assert.equal(summary.firstMessage, "hello there");
  assert.equal(summary.created, "2026-01-01T00:00:00.000Z");
  // Last user/assistant activity wins over the header timestamp.
  assert.equal(summary.modified, "2026-01-01T00:00:09.000Z");
  assert.equal(summary.parentSessionPath, "/tmp/parent.jsonl");
});

test("a numeric message timestamp wins over the entry timestamp", async (t) => {
  const agent = makeAgentDir(t);
  const entry = message("m1", "user", "hi", "2026-01-01T00:00:00.000Z");
  entry.message.timestamp = Date.parse("2026-02-02T00:00:00.000Z");
  agent.write("--tmp-proj--", "s1.jsonl", line(sessionFile()) + line(entry));

  const [summary] = await scanSessionFiles();
  assert.equal(summary.modified, "2026-02-02T00:00:00.000Z");
});

test("falls back to the header timestamp when nothing else is available", async (t) => {
  const agent = makeAgentDir(t);
  agent.write("--tmp-proj--", "s1.jsonl", line(sessionFile({ timestamp: "2026-03-03T00:00:00.000Z" })));

  const [summary] = await scanSessionFiles();
  assert.equal(summary.messageCount, 0);
  assert.equal(summary.firstMessage, "(no messages)");
  assert.equal(summary.modified, "2026-03-03T00:00:00.000Z");
});

test("skips files that are not transcripts and reads nested session directories", async (t) => {
  const agent = makeAgentDir(t);
  agent.write("--tmp-proj--", "not-a-session.jsonl", `${JSON.stringify({ type: "message" })}\n`);
  agent.write("--tmp-other--", "s2.jsonl", line(sessionFile({ id: "s2", cwd: "/tmp/other" })));
  agent.write("--tmp-proj--", "ignored.txt", "not a jsonl file");

  const summaries = await scanSessionFiles();
  assert.deepEqual(summaries.map((entry) => entry.id), ["s2"]);
});

test("an unchanged file is served from the index without re-reading it", async (t) => {
  const agent = makeAgentDir(t);
  const filePath = agent.write(
    "--tmp-proj--",
    "s1.jsonl",
    line(sessionFile()) + line(message("m1", "user", "original", "2026-01-01T00:00:01.000Z")),
  );
  // Pin a whole-millisecond mtime so the cache key is reproducible; writing the
  // file below restores exactly this value.
  const pinned = new Date(1_700_000_000_000);
  utimesSync(filePath, pinned, pinned);

  const [first] = await scanSessionFiles();
  assert.equal(first.firstMessage, "original");

  // Same length, different content, mtime restored to the pinned value: a cache
  // keyed on size + mtime reads this as "nothing changed".
  writeFileSync(
    filePath,
    line(sessionFile({ id: "s9" })) + line(message("m1", "user", "changed!", "2026-01-01T00:00:01.000Z")),
  );
  utimesSync(filePath, pinned, pinned);

  const [cached] = await scanSessionFiles();
  assert.equal(cached.firstMessage, "original", "an unchanged file must not be re-parsed");

  // Touch it: a different mtime is what makes the entry stale.
  utimesSync(filePath, new Date(pinned.getTime() + 5000), new Date(pinned.getTime() + 5000));
  const [refreshed] = await scanSessionFiles();
  assert.equal(refreshed.firstMessage, "changed!");
  assert.equal(refreshed.id, "s9");
});

test("drops entries for files that disappeared", async (t) => {
  const agent = makeAgentDir(t);
  const filePath = agent.write("--tmp-proj--", "s1.jsonl", line(sessionFile()));
  await scanSessionFiles();
  assert.equal(globalThis.__piSessionIndexCache?.size, 1);

  rmSync(filePath);
  const summaries = await scanSessionFiles();
  assert.equal(summaries.length, 0);
  assert.equal(globalThis.__piSessionIndexCache?.size, 0);
});
