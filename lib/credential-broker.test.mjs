import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";
import { createJiti } from "jiti";

const execFileAsync = promisify(execFile);
const jiti = createJiti(import.meta.url);
const { createCredentialBrokerOperations } = await jiti.import("./credential-broker.ts");

test("askpass receives a credential without exposing it through bash output", async () => {
  let receivedPrompt = "";
  let receivedEnv;
  const base = {
    async exec(_command, _cwd, options) {
      receivedEnv = options.env;
      const result = await execFileAsync(receivedEnv.GIT_ASKPASS, ["Password for https://example.test:"] , {
        env: receivedEnv,
      });
      return { exitCode: result.stdout.trim() === "secret-value" ? 0 : 1 };
    },
  };

  const operations = createCredentialBrokerOperations(
    base,
    async (prompt) => {
      receivedPrompt = prompt;
      return "secret-value";
    },
    { platform: "darwin", processPath: process.execPath },
  );

  const result = await operations.exec("git push", "/tmp", {
    onData() {},
    env: { PATH: "/usr/bin" },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(receivedPrompt, "Password for https://example.test:");
  assert.equal(receivedEnv.GIT_TERMINAL_PROMPT, "0");
  assert.match(receivedEnv.GIT_ASKPASS, /askpass\.js$/);
  assert.equal(await readFile(receivedEnv.GIT_ASKPASS).catch(() => null), null);
});

test("rejects non-credential prompts without calling the user UI", async () => {
  let called = false;
  const base = {
    async exec(_command, _cwd, options) {
      const result = await execFileAsync(options.env.GIT_ASKPASS, ["Continue?"], { env: options.env });
      assert.equal(result.stdout, "");
      return { exitCode: 0 };
    },
  };
  const operations = createCredentialBrokerOperations(base, async () => {
    called = true;
    return "should-not-be-used";
  }, { platform: "linux", processPath: process.execPath });

  await operations.exec("echo ready", "/tmp", { onData() {} });
  assert.equal(called, false);
});
