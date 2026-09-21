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
});

test("renders a read-only keyboard shortcut section from the shared catalog", () => {
  assert.match(source, /id: "shortcuts", label: t\("settings\.shortcuts"\)/);
  assert.match(source, /KEYBOARD_SHORTCUT_GROUPS\.map/);
  assert.match(source, /KEYBOARD_SHORTCUTS\.filter/);
  assert.match(source, /<kbd key=\{key\}/);
  assert.match(shortcutCatalog, /export const KEYBOARD_SHORTCUTS/);
  assert.match(shortcutCatalog, /id: "mention-lines"/);
});
