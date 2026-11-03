import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");

test("double-clicking a file or folder name starts inline rename", () => {
  assert.match(source, /onDoubleClick=\{\(event\) => \{[\s\S]*?startRename\(\);/);
  assert.match(source, /ref=\{renameInputRef\}[\s\S]*?aria-label=\{t\("i18n\.rename"\)\}/);
});

test("inline rename submits with PATCH and supports Enter and Escape", () => {
  assert.match(source, /method: "PATCH"/);
  assert.match(source, /body: JSON\.stringify\(\{ name \}\)/);
  assert.match(source, /event\.key === "Enter"[\s\S]*?event\.currentTarget\.blur\(\)/);
  assert.match(source, /event\.key === "Escape"[\s\S]*?cancelRename\(\)/);
});

test("rename protection covers files and folders with open descendants", () => {
  assert.match(source, /canRenamePath && !canRenamePath\(node\.fullPath\)/);
  assert.match(source, /t\("files\.renameUnsaved"\)/);
});

test("a collapsed Java package row keeps the server-provided innermost path", () => {
  // 服务端把 `com/example/demo` 折叠成一行 `com.example.demo`，目录名不再是路径最后
  // 一段，所以 fullPath 只能取自 entryPath。
  assert.match(source, /fullPath: e\.entryPath \?\? joinFilePath\(dirPath, e\.name\)/);
  assert.match(source, /entryPath\?: string/);
});

test("a collapsed Java package row cannot be renamed", () => {
  assert.match(source, /if \(node\.packageChain\) return;/);
});

test("an expanding or refreshing folder turns its chevron into the loading spinner", () => {
  // 加载指示必须在箭头的位置上，而不是行尾再挂一个图标：
  // 行尾那个转圈会和重命名输入框、Git 徽标抢位置，文件名也会跟着抖。
  assert.match(
    source,
    /\{node\.isDir && \([\s\S]*?\{loading \? \(\s*<TreeLoadingSpinner size=\{10\} label=\{t\("files\.loading"\)\} \/>\s*\) : \(/,
  );
  assert.doesNotMatch(source, /M12 2v4M12 18v4/);
});

test("a refresh keeps the visible root list and reports loading upward", () => {
  // 只有换项目才清空根节点；单纯刷新时保留列表，转圈交给侧边栏标题行的箭头。
  assert.match(source, /if \(cwdChanged\) setRoots\(\[\]\);\s*\n\s*setLoading\(true\);/);
  assert.match(source, /onLoadingChange\?\.\(loading\)/);
  assert.match(source, /error \? \([\s\S]*?\) : loading && roots\.length === 0 \? \(/);
});
