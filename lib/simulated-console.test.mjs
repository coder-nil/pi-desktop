import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  tsconfigPaths: true,
});

async function loadSubject() {
  return jiti.import("./simulated-console.ts");
}

test("reports the active project and saved session", async () => {
  const { executeSimulatedConsoleCommand } = await loadSubject();

  assert.deepEqual(
    executeSimulatedConsoleCommand("pwd", { cwd: "/tmp/project", sessionId: "s1" }).lines,
    [{ kind: "output", text: "/tmp/project" }],
  );
  assert.deepEqual(
    executeSimulatedConsoleCommand("session", { cwd: "/tmp/project", sessionId: "s1", sessionName: "Demo" }).lines,
    [
      { kind: "output", text: "Name: Demo" },
      { kind: "output", text: "ID: s1" },
    ],
  );
});

test("handles local-only commands without starting a shell", async () => {
  const { executeSimulatedConsoleCommand } = await loadSubject();

  assert.equal(executeSimulatedConsoleCommand("clear", { cwd: null, sessionId: null }).clear, true);
  assert.deepEqual(
    executeSimulatedConsoleCommand("echo hello pi", { cwd: null, sessionId: null }).lines,
    [{ kind: "output", text: "hello pi" }],
  );
  assert.deepEqual(
    executeSimulatedConsoleCommand("history", { cwd: null, sessionId: null, history: ["pwd", "history"] }).lines,
    [
      { kind: "output", text: "1  pwd" },
      { kind: "output", text: "2  history" },
    ],
  );
});

test("returns a helpful error for unsupported commands", async () => {
  const { executeSimulatedConsoleCommand } = await loadSubject();

  assert.deepEqual(
    executeSimulatedConsoleCommand("npm test", { cwd: "/tmp/project", sessionId: null }).lines,
    [
      { kind: "error", text: "npm test: command not found" },
      { kind: "output", text: "Type help to see available commands." },
    ],
  );
});
