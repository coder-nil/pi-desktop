import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const inputSource = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const shellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("places the console button beside the skill picker", () => {
  const skillPicker = inputSource.indexOf('title={t("chat.chooseSkill")}');
  const consoleButton = inputSource.indexOf('title={t("console.open")}');
  const modelSelector = inputSource.indexOf("{/* Model selector", consoleButton);

  assert.notEqual(skillPicker, -1);
  assert.ok(consoleButton > skillPicker);
  assert.ok(modelSelector > consoleButton);
  assert.match(inputSource, /onClick=\{onOpenConsole\}/);
});

test("passes the console action and active state from the shell", () => {
  assert.match(shellSource, /onOpenConsole=\{handleOpenConsole\}/);
  assert.match(shellSource, /consoleActive=\{consoleOpen && terminalCwds\.includes/);
  assert.doesNotMatch(shellSource, /renderMainConsoleToggle/);
});

test("toggles the console closed when its button is clicked again", () => {
  const handler = shellSource.match(/const handleOpenConsole = useCallback\([\s\S]*?\n  \}, \[[^\n]+\);/)?.[0];
  assert.ok(handler);
  assert.match(handler, /setConsoleOpen\(\(current\) => terminalCwds\.includes\(cwd\) \? !current : true\)/);
});
