import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const viewerSource = await readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8");
const editorSource = await readFile(new URL("./MonacoEditor.tsx", import.meta.url), "utf8");

test("file editing saves empty content and parses non-JSON failures safely", () => {
  assert.match(viewerSource, /if \(content === null \|\| savingRef\.current\) return/);
  assert.match(viewerSource, /const originalContentRef = useRef<string \| null>\(null\)/);
  assert.match(viewerSource, /const originalContent = originalContentRef\.current \?\? data\?\.content \?\? ""/);
  assert.match(viewerSource, /content === originalContent/);
  assert.match(viewerSource, /allowEmpty: content === ""/);
  assert.match(viewerSource, /window\.confirm\(t\("i18n\.confirmEmptyFile"\)\)/);
  assert.match(viewerSource, /res\.json\(\)\.catch\(\(\) => \(\{\}\)\)/);
});

test("editor only saves through explicit commands", () => {
  assert.match(editorSource, /只通过明确的保存命令写入文件/);
  assert.match(editorSource, /onSave\(editorRef\.current\?\.getValue\(\) \?\? value\)/);
  assert.doesNotMatch(editorSource, /setTimeout\(\(\) => onSave/);
});

test("editor keeps Monaco content internal after the initial mount", () => {
  assert.match(editorSource, /defaultValue=\{value\}/);
  assert.doesNotMatch(editorSource, /\n\s+value=\{value\}/);
});
test("editable files open straight into the editor without overriding explicit view intents", () => {
  assert.match(viewerSource, /const autoEditAppliedRef = useRef\(false\)/);
  assert.match(viewerSource, /if \(!editable \|\| autoEditAppliedRef\.current\) return/);
  assert.match(viewerSource, /dataPathRef\.current !== filePath/);
  assert.match(viewerSource, /requestedInitialDisplayMode === "diff"/);
  assert.match(viewerSource, /pendingRevealLineRef\.current !== null/);
  assert.match(viewerSource, /data\.language === "markdown" \|\| data\.language === "html"/);
  assert.match(viewerSource, /autoEditAppliedRef\.current = true;\n\s+startEditing\(\);/);
});

test("edit mode owns the surface and hides the view-mode switch", () => {
  assert.match(viewerSource, /\{!editing && displayModes\.length > 1 && \(/);
  assert.match(viewerSource, /\{!editing && effectiveDisplayMode === "source" && \(/);
  assert.match(viewerSource, /\{!editing && searchOpen && effectiveDisplayMode === "source" && \(/);
  assert.match(viewerSource, /if \(event\.key\.toLowerCase\(\) !== "f" \|\| editing \|\| displayMode !== "source"\) return;/);
  assert.match(viewerSource, /setEditing\(true\);\n\s+setSaveError\(null\);\n\s+\/\/ [\s\S]*\n\s+setSearchOpen\(false\);/);
});

test("the save-and-exit command persists the latest draft instead of a stale editor handle", () => {
  assert.match(viewerSource, /draftRef\.current = data\.content/);
  assert.match(viewerSource, /draftRef\.current = next/);
  assert.match(viewerSource, /handleSaveAndExit[\s\S]*persistContent\(draftRef\.current \?\? draft\)/);
  assert.match(viewerSource, /onClick=\{editing \? handleSaveAndExit : startEditing\}/);
  assert.doesNotMatch(viewerSource, /handleExitEditing/);
});
