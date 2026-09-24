import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { applyShellTool, gitBashCandidates, normalizeActiveShellTool, resolveShellSelection, selectShellTool } = await jiti.import("./shell-tool.ts");

test("keeps bash on non-Windows platforms", () => {
  assert.equal(selectShellTool({
    platform: "darwin",
    bashAvailable: false,
    powerShellAvailable: true,
  }), "bash");
});

test("prefers bash on Windows when Git Bash is available", () => {
  assert.equal(selectShellTool({
    platform: "win32",
    bashAvailable: true,
    powerShellAvailable: true,
  }), "bash");
});

test("falls back to PowerShell on Windows without Git Bash", () => {
  assert.equal(selectShellTool({
    platform: "win32",
    bashAvailable: false,
    powerShellAvailable: true,
  }), "powershell");
});

test("respects an explicit shellPath and keeps the SDK's missing-bash error", () => {
  assert.equal(selectShellTool({
    platform: "win32",
    configuredShellPath: "C:/custom/bash.exe",
    bashAvailable: false,
    powerShellAvailable: true,
  }), "bash");
  assert.equal(selectShellTool({
    platform: "win32",
    bashAvailable: false,
    powerShellAvailable: false,
  }), "bash");
});

test("replaces the portable bash slot with PowerShell", () => {
  assert.deepEqual(applyShellTool(["read", "bash", "edit", "write"], "powershell"), [
    "read",
    "powershell",
    "edit",
    "write",
  ]);
  assert.deepEqual(applyShellTool(["read", "bash", "powershell", "edit"], "powershell"), [
    "read",
    "powershell",
    "edit",
  ]);
  assert.deepEqual(applyShellTool(["read", "grep"], "powershell"), ["read", "grep"]);
  assert.deepEqual(applyShellTool(["read", "bash"], "bash"), ["read", "bash"]);
});

test("normalizes inherited active tools for the selected shell", () => {
  assert.deepEqual(
    normalizeActiveShellTool(["read", "bash", "edit", "powershell"], "powershell"),
    ["read", "powershell", "edit"],
  );
  assert.deepEqual(
    normalizeActiveShellTool(["read", "bash", "edit", "powershell", "web_search"], "bash"),
    ["read", "bash", "edit", "web_search"],
  );
});

test("derives Git Bash from the git executable when it is not in the default location", () => {
  assert.deepEqual(
    gitBashCandidates("C:\\Program Files\\Git\\cmd\\git.exe"),
    ["C:\\Program Files\\Git\\bin\\bash.exe"],
  );
  assert.deepEqual(
    gitBashCandidates("D:\\Tools\\Git\\cmd\\git.exe", "D:/Tools/Git/mingw64/libexec/git-core"),
    ["D:\\Tools\\Git\\bin\\bash.exe"],
  );
});

test("keeps bash on non-Windows without an explicit shell path", () => {
  assert.deepEqual(resolveShellSelection({ getShellPath: () => undefined }, "darwin"), { tool: "bash" });
});

test("preserves an explicit shell path on every platform", () => {
  assert.deepEqual(
    resolveShellSelection({ getShellPath: () => "/opt/homebrew/bin/bash" }, "darwin"),
    { tool: "bash", shellPath: "/opt/homebrew/bin/bash" },
  );
  assert.deepEqual(
    resolveShellSelection({ getShellPath: () => "C:/cygwin64/bin/bash.exe" }, "win32"),
    { tool: "bash", shellPath: "C:/cygwin64/bin/bash.exe" },
  );
});

// 设置 → 常规 → Shell 工具：显式选择优先于可用性探测。
test("honours an explicit PowerShell choice over the availability probe", () => {
  assert.deepEqual(
    resolveShellSelection(
      { getShellPath: () => undefined, getDefaultTools: () => ["read", "powershell", "edit"] },
      "win32",
    ),
    { tool: "powershell" },
  );
});

test("keeps an explicit shell path ahead of the PowerShell setting", () => {
  assert.deepEqual(
    resolveShellSelection(
      { getShellPath: () => "C:/custom/bash.exe", getDefaultTools: () => ["powershell"] },
      "win32",
    ),
    { tool: "bash", shellPath: "C:/custom/bash.exe" },
  );
});

test("ignores the PowerShell setting off Windows", () => {
  assert.deepEqual(
    resolveShellSelection(
      { getShellPath: () => undefined, getDefaultTools: () => ["powershell"] },
      "darwin",
    ),
    { tool: "bash" },
  );
});

test("falls back to the probe when the settings source has no defaultTools", () => {
  // 桩对象/老调用点可能只实现 getShellPath；可选调用不能抛错。
  assert.deepEqual(resolveShellSelection({ getShellPath: () => undefined }, "darwin"), { tool: "bash" });
});
