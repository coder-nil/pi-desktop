import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const viewerSource = await readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8");
const editorSource = await readFile(new URL("./MonacoEditor.tsx", import.meta.url), "utf8");
const stateSource = await readFile(new URL("../lib/file-viewer-state.ts", import.meta.url), "utf8");

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

test("the editor model carries a real path and skips project-less semantic checks", () => {
  // 文件名后缀决定 Monaco 的 ScriptKind；没有 .tsx 会把 JSX 当普通 TS 解析。
  assert.match(editorSource, /path\?: string;/);
  assert.match(editorSource, /path=\{path\}/);
  assert.match(viewerSource, /<MonacoFileEditor[\s\S]*?path=\{filePath\}/);
  // 无项目上下文时语义校验全是误报，只保留语法校验；jsx 必须显式配置。
  assert.match(editorSource, /function configureLanguageServices\(monacoApi: unknown\)/);
  assert.match(editorSource, /jsx: 4, \/\/ JsxEmit\.ReactJSX/);
  assert.match(editorSource, /noSemanticValidation: true/);
  assert.match(editorSource, /defaults\.setCompilerOptions\(compilerOptions\)/);
  assert.match(editorSource, /defaults\.setDiagnosticsOptions\(diagnosticsOptions\)/);
  // 配置要用 @monaco-editor/react 交回的真实实例（beforeMount），否则 jsx 落不到编辑器上。
  assert.match(editorSource, /beforeMount=\{handleBeforeMount\}/);
  assert.match(editorSource, /handleBeforeMount[\s\S]*configureLanguageServices\(monacoApi\)/);
});

test("edit is a first-class display mode and editable files open straight into it", () => {
  assert.match(stateSource, /export type FileViewerDisplayMode = "edit" \| "source" \| "preview" \| "diff";/);
  assert.match(viewerSource, /const requestedInitialDisplayMode: DisplayMode = \(/);
  assert.match(
    viewerSource,
    /initialState === undefined\n\s+&& initialDisplayMode === undefined\n\s+&& editable\n\s+&& initialLine === undefined/,
  );
  assert.match(viewerSource, /\? "edit"\n\s+: explicitInitialDisplayMode;/);
  assert.match(viewerSource, /\.\.\.\(editable \? \["edit" as const\] : \[\]\),/);
  assert.match(viewerSource, /edit: "Edit",/);
  // editing 由当前模式推导，不再是独立开关。
  assert.match(viewerSource, /const editing = displayMode === "edit" && editable && data !== null;/);
  assert.doesNotMatch(viewerSource, /useState\(false\);\n\s*\/\*\* 编辑缓冲区/);
});

test("the mode switch is the single control for edit, source, preview and diff", () => {
  assert.match(viewerSource, /onClick=\{\(\) => \(mode === "edit" \? enterEditMode\(\) : updateDisplayMode\(mode\)\)\}/);
  assert.match(viewerSource, /disabled=\{mode === "edit" && !data\}/);
  assert.match(viewerSource, /\{displayModes\.length > 1 && \(/);
});

test("saving keeps the editor open and only advances the baseline", () => {
  // 没有实际改动时直接返回，不退出编辑。
  assert.match(
    viewerSource,
    /if \(!userEditedRef\.current \|\| content === originalContent\) \{[\s\S]*setSaveError\(null\);\n\s+return;\n\s+\}/,
  );
  // 保存成功后基线前移、草稿与磁盘同步，但仍在 Edit 模式。
  assert.match(
    viewerSource,
    /originalContentRef\.current = content;\n\s+userEditedRef\.current = false;\n\s+draftRef\.current = content;\n\s+setDraft\(content\);/,
  );
  assert.doesNotMatch(viewerSource, /setEditing\(/);
  assert.match(viewerSource, /const handleSave = useCallback\(\(\) => \{\n\s+void persistContent\(draftRef\.current \?\? draft\);/);
  assert.match(viewerSource, /onClick=\{handleSave\}/);
});

test("draft dirty state outlives leaving the editor and entering edit keeps the draft", () => {
  assert.match(viewerSource, /const isDirty = draft !== null && draft !== \(data\?\.content \?\? ""\)/);
  assert.match(viewerSource, /if \(draftRef\.current === null\) \{/);
  assert.doesNotMatch(viewerSource, /handleExitEditing/);
});
