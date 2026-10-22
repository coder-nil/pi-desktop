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
    /initialState === undefined\n\s+&& initialDisplayMode === undefined\n\s+&& editable\n\s+&& !openedWithLineRef\.current/,
  );
  assert.match(viewerSource, /\? "edit"\n\s+: explicitInitialDisplayMode;/);
  // 行号被消费后 initialLine 会变 undefined，默认模式必须只按挂载时的值算，
  // 否则源码查看会在定位完成后自己翻成 Edit。
  assert.match(viewerSource, /const openedWithLineRef = useRef\(initialLine !== undefined\)/);
  assert.doesNotMatch(viewerSource, /&& initialLine === undefined\n\s+\)\n\s+\? "edit"/);
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
    /originalContentRef\.current = content;\n\s+userEditedRef\.current = false;\n\s+draftRef\.current = content;\n\s+dirtyRef\.current = false;\n\s+setDraft\(content\);/,
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

test("external edits never clobber a dirty draft, they only surface a reload notice", async () => {
  // watch 的 synchronize 先看 savingRef（自己的写入）再看 dirty。
  assert.match(viewerSource, /if \(savingRef\.current\) \{\n\s+resyncAfterSaveRef\.current = true;/);
  assert.match(viewerSource, /if \(dirtyRef\.current\) \{\n\s+setDiskChangePending\(true\);/);
  assert.match(viewerSource, /const dirtyRef = useRef\(isDirty\);/);
  // 保存期间收到的磁盘事件在保存结束后补核对一次。
  assert.match(viewerSource, /if \(resyncAfterSaveRef\.current\) \{\n\s+resyncAfterSaveRef\.current = false;\n\s+resyncRef\.current\?\.\(\);/);
  // 提示条只在磁盘变化且未能应用时出现，动作是显式重载。
  assert.match(viewerSource, /\{diskChangePending && \(/);
  assert.match(viewerSource, /onClick=\{\(\) => void handleReloadFromDisk\(\)\}/);
  assert.match(viewerSource, /const handleReloadFromDisk = useCallback\(async \(\) => \{/);
  // 保存成功等于用户选择以本地草稿为准，提示作废。
  assert.match(viewerSource, /setDiskChangePending\(false\);/);

  const [en, zh] = await Promise.all([
    readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8"),
  ]);
  for (const source of [en, zh]) {
    assert.match(source, /"i18n\.fileChangedOnDisk": "/);
    assert.match(source, /"i18n\.reloadFromDisk": "/);
  }
});

test("applying disk content moves the baseline without marking a user edit", () => {
  assert.match(viewerSource, /const applyingExternalRef = useRef\(false\);/);
  assert.match(viewerSource, /if \(applyingExternalRef\.current\) return;/);
  // Monaco 用 defaultValue 建模型，prop 变化不会回写，只能直接 setValue。
  assert.match(viewerSource, /applyingExternalRef\.current = true;[\s\S]{0,200}model\.setValue\(next\.content\);/);
  assert.match(viewerSource, /originalContentRef\.current = next\.content;/);
  // 从未进入编辑态时只更新只读视图，不凭空造草稿。
  assert.match(viewerSource, /if \(draftRef\.current === null && !model\) return;/);
});

test("undo and redo work inside the desktop WebView", () => {
  // 撤销/恢复在 document 的 capture 阶段抢：Tauri 的 WebView 会先把 Ctrl/Cmd+Z
  // 当原生编辑命令吃掉，Monaco 自己的绑定根本收不到 keydown。
  assert.match(editorSource, /document\.addEventListener\("keydown", handleUndoRedoKey, true\)/);
  assert.match(editorSource, /if \(!\(event\.metaKey \|\| event\.ctrlKey\) \|\| event\.altKey\) return;/);
  assert.match(editorSource, /const isUndo = key === "z" && !event\.shiftKey;/);
  // Ctrl+U 是常见的「恢复」习惯键，与 Ctrl+Y / Cmd+Shift+Z 等价。
  assert.match(editorSource, /const isRedo = key === "y" \|\| key === "u" \|\| \(key === "z" && event\.shiftKey\);/);
  assert.match(editorSource, /editor\.trigger\("keyboard", isUndo \? "undo" : "redo", null\)/);
  // 只接管编辑器里的按键，且必须先取消默认行为，否则原生撤销和 Monaco 各撤一步。
  assert.match(editorSource, /!dom\.contains\(event\.target\)\) return;\n\s+event\.preventDefault\(\);\n\s+event\.stopPropagation\(\);/);
  assert.match(editorSource, /undo: \(\) => editorRef\.current\?\.trigger\("keyboard", "undo", null\)/);
  assert.match(editorSource, /redo: \(\) => editorRef\.current\?\.trigger\("keyboard", "redo", null\)/);
});

test("the edit toolbar exposes undo and redo with the stack state", () => {
  assert.match(viewerSource, /<Undo2 size=\{14\}/);
  assert.match(viewerSource, /<Redo2 size=\{14\}/);
  assert.match(viewerSource, /onClick=\{\(\) => editorHandleRef\.current\?\.undo\(\)\}/);
  assert.match(viewerSource, /onClick=\{\(\) => editorHandleRef\.current\?\.redo\(\)\}/);
  assert.match(viewerSource, /disabled=\{!undoState\.canUndo\}/);
  assert.match(viewerSource, /disabled=\{!undoState\.canRedo\}/);
  assert.match(viewerSource, /onUndoStateChange=\{setUndoState\}/);
  // 撤销栈变化同时驱动两个按钮的可用状态。
  assert.match(editorSource, /canUndo: model\?\.canUndo\(\) \?\? false,/);
  assert.match(editorSource, /canRedo: model\?\.canRedo\(\) \?\? false,/);
  assert.match(editorSource, /editor\.onDidChangeModelContent\(notifyUndoState\)/);
});

test("the undo and redo hints follow the platform modifier key", () => {
  assert.match(viewerSource, /import \{ isMacPlatform, type ModifierKeyLabel \} from "@\/lib\/platform-key";/);
  assert.match(viewerSource, /const \[modifierKey, setModifierKey\] = useState<ModifierKeyLabel>\("Ctrl"\);/);
  // 首帧一律 Ctrl（服务端没有 navigator），客户端再改成 Cmd，避免 hydration 属性不一致。
  assert.match(viewerSource, /if \(isMacPlatform\(\)\) setModifierKey\("Cmd"\);/);
  assert.match(viewerSource, /t\("i18n\.undo", \{ mod: modifierKey \}\)/);
  assert.match(viewerSource, /t\("i18n\.redo", \{ mod: modifierKey \}\)/);
});

test("both locales format the modifier key from the platform", async () => {
  const [en, zh] = await Promise.all([
    readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8"),
  ]);
  assert.match(zh, /"i18n\.undo": "撤销（\{mod\}\+Z）"/);
  assert.match(zh, /"i18n\.redo": "恢复（\{mod\}\+U）"/);
  assert.match(en, /"i18n\.undo": "Undo \(\{mod\}\+Z\)"/);
  assert.match(en, /"i18n\.redo": "Redo \(\{mod\}\+U\)"/);
});
