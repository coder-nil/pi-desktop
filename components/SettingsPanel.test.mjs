import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const generalView = source.match(/view === "general" \? \([\s\S]*?\) : view === "mcp" \? \(/)?.[0];

test("groups interface preferences under General", () => {
  assert.match(source, /type SettingsView = "menu" \| "general" \| "mcp" \| "mcp-editor"/);
  assert.match(source, /\["general", t\("settings\.general"\), t\("settings\.generalDescription"\), \(\) => setView\("general"\), false\]/);
  assert.ok(generalView);
  assert.match(generalView, /renderThemeRow\(\)/);
  assert.match(generalView, /renderLanguageRow\(\)/);
  assert.match(generalView, /t\("settings\.completionSound"\)/);
  assert.match(generalView, /t\("settings\.showBanner"\)/);
});

test("labels the General subview in the settings header", () => {
  assert.match(source, /view === "general" \? t\("settings\.general"\) : t\("settings\.title"\)/);
});
