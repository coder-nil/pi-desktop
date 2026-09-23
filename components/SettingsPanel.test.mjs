import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const shortcutCatalog = await readFile(new URL("../lib/keyboard-shortcuts.ts", import.meta.url), "utf8");

test("keeps all settings resources inside one navigable dialog", () => {
  assert.match(source, /type SettingsView = "menu" \| "general" \| "shortcuts" \| "models" \| "skills" \| "plugins" \| "mcp" \| "mobile" \| "mcp-editor"/);
  assert.match(source, /<ModelsConfig embedded onSaved=\{onModelsSaved\} \/>/);
  assert.match(source, /<SkillsConfig cwd=\{cwd\} embedded \/>/);
  assert.match(source, /<PluginsConfig cwd=\{cwd\} sessionId=\{sessionId\} embedded onReloaded=\{onSessionReloaded\} \/>/);
  assert.match(source, /<MobileAccessSettings \/>/);
  assert.doesNotMatch(source, /onOpenModels|onOpenSkills|onOpenPlugins/);
});

test("the settings overlay sits above every other layer", () => {
  // 设置是最高的弹层：高于关于对话框(1200)、SelectPicker 下拉(1201)、
  // Git 面板与各确认框(1100/1200)，同时内嵌子对话框仍靠面板自己的层叠上下文。
  const match = source.match(/position: "fixed", inset: 0, zIndex: (\d+)/);
  assert.ok(match, "settings overlay should be a fixed layer with an explicit zIndex");
  assert.ok(Number(match[1]) > 1201, `settings zIndex ${match[1]} must exceed every other layer`);
  assert.match(source, /<AboutDialog embedded onClose=\{\(\) => setAboutOpen\(false\)\} \/>/);
});

test("retains visited settings sections and supports the mobile back flow", () => {
  assert.match(source, /const \[visitedSections, setVisitedSections\]/);
  assert.match(source, /updated\.add\(next\)/);
  assert.match(source, /isMobile && visibleView !== "menu"/);
  assert.match(source, /setView\(view === "mcp-editor" \? "mcp" : "menu"\)/);
});

test("groups interface preferences under General", () => {
  assert.match(source, /visitedSections\.has\("general"\)/);
  assert.match(source, /renderThemeRow\(\)/);
  assert.match(source, /renderLanguageRow\(\)/);
  assert.match(source, /t\("settings\.completionSound"\)/);
  assert.match(source, /t\("settings\.showBanner"\)/);
  // 「关于」固定在常规页的最后一行，并且整行可点（设置里不再放 ⓘ）。
  assert.ok(source.indexOf("{renderAboutRow()}") > source.indexOf('t("settings.showBanner")'));
  assert.match(source, /const renderAboutRow = \(\) => \(\s*<button/);
});

test("renders a read-only keyboard shortcut section from the shared catalog", () => {
  assert.match(source, /id: "shortcuts", label: t\("settings\.shortcuts"\)/);
  assert.match(source, /KEYBOARD_SHORTCUT_GROUPS\.map/);
  assert.match(source, /KEYBOARD_SHORTCUTS\.filter/);
  assert.match(source, /<kbd key=\{key\}/);
  assert.match(shortcutCatalog, /export const KEYBOARD_SHORTCUTS/);
  assert.match(shortcutCatalog, /id: "mention-lines"/);
});
