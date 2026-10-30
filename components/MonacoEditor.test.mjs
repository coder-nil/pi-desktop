import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./MonacoEditor.tsx", import.meta.url), "utf8");

test("undo and redo go straight to the model instead of the command service", () => {
  // editor.trigger("keyboard", "undo") 在 Monaco 里是「有焦点才作用于模型，否则
  // document.execCommand('undo')」的多实现命令，后者对编辑器内容无效。粘贴会让
  // WKWebView 里的 textarea 先失焦，hasTextFocus() 恢复不及时，撤销就静默失灵。
  assert.match(source, /const model = editorRef\.current\?\.getModel\(\);\s*\n\s*if \(!model\) return;\s*\n\s*if \(isUndo\) model\.undo\(\);\s*\n\s*else model\.redo\(\);/);
  assert.doesNotMatch(source, /trigger\("keyboard", isUndo \? "undo" : "redo"/);
  assert.doesNotMatch(source, /undo: \(\) => editorRef\.current\?\.trigger\(\s*"keyboard",\s*"undo"/);
});

test("the undo shortcut is captured before Monaco's own binding", () => {
  assert.match(source, /document\.addEventListener\("keydown", handleUndoRedoKey, true\)/);
  // stopPropagation 是必需的，否则 Monaco 的默认绑定会再撤一步。
  assert.match(source, /event\.preventDefault\(\);\s*\n\s*event\.stopPropagation\(\);\s*\n\s*undoRedoSilently\(isUndo\);/);
});

test("a paste starts a fresh undo group so it can be undone on its own", () => {
  assert.match(source, /document\.addEventListener\("paste", handlePasteBoundary, true\)/);
  assert.match(source, /editor\.pushUndoStop\(\)/);
  // 只在粘贴发生在编辑器内部时断开分组，别给聊天输入框的粘贴制造空分组。
  assert.match(source, /const dom = editor\.getDomNode\(\);\s*\n\s*if \(!dom \|\| !\(event\.target instanceof Node\) \|\| !dom\.contains\(event\.target\)\) return;\s*\n\s*editor\.pushUndoStop\(\);/);
});

test("both document listeners are removed when the editor goes away", () => {
  assert.match(source, /document\.removeEventListener\("keydown", handleUndoRedoKey, true\)/);
  assert.match(source, /document\.removeEventListener\("paste", handlePasteBoundary, true\)/);
});
