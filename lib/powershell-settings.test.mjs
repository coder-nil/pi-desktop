import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  isPowerShellToolEnabled,
  readPowerShellToolEnabled,
  replaceShellTool,
  writePowerShellToolEnabled,
} = await jiti.import("./powershell-settings.ts");

async function withTempSettings(run) {
  const dir = mkdtempSync(join(tmpdir(), "pi-powershell-settings-"));
  try {
    return await run(join(dir, "settings.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("only an explicit powershell slot counts as enabled", () => {
  assert.equal(isPowerShellToolEnabled(["read", "bash", "edit"]), false);
  assert.equal(isPowerShellToolEnabled(["read", "powershell", "edit"], "win32"), true);
  // bash 还在列表里时以 bash 为准（与 pi 的 defaultTools 语义一致）。
  assert.equal(isPowerShellToolEnabled(["bash", "powershell"], "win32"), false);
  assert.equal(isPowerShellToolEnabled(undefined, "win32"), false);
  // 非 Windows 上这个设置没有意义。
  assert.equal(isPowerShellToolEnabled(["powershell"], "darwin"), false);
});

test("replaces whichever shell slot appears and keeps the rest", () => {
  assert.deepEqual(replaceShellTool(["read", "bash", "edit"], true), ["read", "powershell", "edit"]);
  assert.deepEqual(replaceShellTool(["read", "powershell", "edit"], false), ["read", "bash", "edit"]);
  assert.deepEqual(replaceShellTool(["read", "write"], true), ["read", "write"]);
  // 去重：两个 shell 槽只留下选中的那个。
  assert.deepEqual(replaceShellTool(["bash", "powershell"], true), ["powershell"]);
});

test("a missing settings file means 'not configured'", () => {
  return withTempSettings(async (settingsPath) => {
    assert.equal(await readPowerShellToolEnabled(settingsPath, "win32"), false);
  });
});

test("writes the switch into defaultTools and reads it back", () => {
  return withTempSettings(async (settingsPath) => {
    assert.equal(await writePowerShellToolEnabled(true, settingsPath, "win32"), true);
    assert.equal(await readPowerShellToolEnabled(settingsPath, "win32"), true);
    assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")).defaultTools, ["read", "powershell", "edit", "write"]);

    assert.equal(await writePowerShellToolEnabled(false, settingsPath, "win32"), false);
    assert.equal(await readPowerShellToolEnabled(settingsPath, "win32"), false);
    assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")).defaultTools, ["read", "bash", "edit", "write"]);
  });
});

test("keeps unrelated settings and adds a shell slot when the list has none", () => {
  return withTempSettings(async (settingsPath) => {
    writeFileSync(settingsPath, JSON.stringify({ defaultModel: "gpt-5", defaultTools: ["read", "edit"] }, null, 2));

    await writePowerShellToolEnabled(true, settingsPath, "win32");

    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    assert.equal(settings.defaultModel, "gpt-5");
    assert.deepEqual(settings.defaultTools, ["read", "edit", "powershell"]);
  });
});

test("refuses to write off Windows and rejects a malformed defaultTools", () => {
  return withTempSettings(async (settingsPath) => {
    await assert.rejects(
      () => writePowerShellToolEnabled(true, settingsPath, "darwin"),
      /only available on Windows/,
    );

    writeFileSync(settingsPath, JSON.stringify({ defaultTools: "bash" }));
    await assert.rejects(
      () => readPowerShellToolEnabled(settingsPath, "win32"),
      /defaultTools must be an array of strings/,
    );
  });
});
