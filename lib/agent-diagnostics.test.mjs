import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { logAgentDiagnostic } = await jiti.import("./agent-diagnostics.ts");

test("agent diagnostics are structured, single-line, truncated, and redacted", (t) => {
  const originalConsoleError = console.error;
  t.after(() => {
    console.error = originalConsoleError;
  });

  let line = "";
  console.error = (value) => {
    line = String(value);
  };

  logAgentDiagnostic("error", "provider_message_error", {
    sessionId: "session-1",
    errorMessage: `Bearer secret-token-value sk-1234567890 ${"x".repeat(2_100)}`,
  });

  assert.match(line, /^\[pi-desktop\] agent_diagnostic \{/);
  assert.equal(line.includes("\n"), false);
  assert.doesNotMatch(line, /secret-token-value|sk-1234567890/);
  assert.match(line, /Bearer <redacted>/);
  assert.match(line, /sk-<redacted>/);
  assert.match(line, /\[truncated /);

  const payload = JSON.parse(line.slice(line.indexOf("{")));
  assert.equal(payload.event, "provider_message_error");
  assert.equal(payload.sessionId, "session-1");
  assert.match(payload.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});
