import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("allows skills CLI repository clones to use its five-minute timeout", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

  assert.match(source, /const SKILLS_INSTALL_TIMEOUT_MS = 310_000/);
  assert.match(source, /maxBuffer: SKILLS_OUTPUT_MAX_BUFFER/);
  assert.match(source, /GIT_TERMINAL_PROMPT: "0"/);
  assert.match(source, /formatSkillCommandOutput\(stdout \+ stderr\)/);
  assert.match(source, /getSystemProxyEnvironment\(\)/);
});
