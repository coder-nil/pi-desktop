import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { searchSessions } = await jiti.import("./session-search.ts");

function session(path, overrides = {}) {
  return {
    path,
    id: overrides.id ?? "session-1",
    cwd: overrides.cwd ?? "/projects/pi-desktop",
    created: overrides.modified ?? "2026-08-24T00:00:00.000Z",
    modified: overrides.modified ?? "2026-08-24T00:00:00.000Z",
    messageCount: 2,
    firstMessage: overrides.firstMessage ?? "Initial question",
    name: overrides.name,
  };
}

test("searches session metadata and visible conversation text", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-desktop-session-search-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const contentMatch = join(dir, "content.jsonl");
  const metadataMatch = join(dir, "metadata.jsonl");
  await writeFile(contentMatch, [
    JSON.stringify({ type: "session", id: "content", cwd: dir }),
    JSON.stringify({ type: "message", message: { role: "user", content: "Please investigate the reconnect regression in detail" } }),
    JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "The stream reconnect now keeps its run id." }] } }),
  ].join("\n"));
  await writeFile(metadataMatch, JSON.stringify({ type: "session", id: "metadata", cwd: dir }));

  const matches = await searchSessions([
    session(contentMatch, { id: "content", modified: "2026-08-23T00:00:00.000Z" }),
    session(metadataMatch, { id: "metadata", name: "Reconnect notes", modified: "2026-08-24T00:00:00.000Z" }),
  ], "reconnect");

  assert.deepEqual(matches.map((match) => match.sessionId), ["metadata", "content"]);
  assert.match(matches[1].snippet, /reconnect regression/i);
});

test("does not match tool results, thinking blocks, or image data", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-desktop-session-search-private-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "session.jsonl");
  await writeFile(path, [
    JSON.stringify({ type: "session", id: "private", cwd: dir }),
    JSON.stringify({ type: "message", message: { role: "assistant", content: [
      { type: "thinking", thinking: "secret-needle" },
      { type: "image", source: { type: "base64", data: "secret-needle" } },
    ] } }),
    JSON.stringify({ type: "message", message: { role: "toolResult", content: [{ type: "text", text: "secret-needle" }] } }),
  ].join("\n"));

  assert.deepEqual(await searchSessions([session(path, { id: "private" })], "secret-needle"), []);
});

test("respects the result limit after sorting by recent activity", async () => {
  const sessions = [1, 2, 3].map((day) => session("", {
    id: `session-${day}`,
    name: "matching title",
    modified: `2026-08-0${day}T00:00:00.000Z`,
  }));

  const matches = await searchSessions(sessions, "matching", 2);
  assert.deepEqual(matches.map((match) => match.sessionId), ["session-3", "session-2"]);
});
