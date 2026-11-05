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

test("a sub-project directory shows a Git badge that opens the panel for that repository", () => {
  // 一个项目目录里可以有多个各自带 .git 的子项目：服务端的 `gitRepository`
  // 一路带到节点上，徽标只在「目录 + 是仓库」的行上出现。
  assert.match(source, /gitRepository\?: boolean;/);
  assert.match(source, /\.\.\.\(e\.gitRepository \? \{ gitRepository: true \} : \{\}\),/);
  assert.match(source, /\{node\.isDir && node\.gitRepository && \(/);
  // 徽标是行内按钮：单击只打开 Git 面板，不展开/收起这一行，也不触发行内的重命名。
  assert.match(source, /onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);\s*onOpen\(repositoryPath\);\s*\}\}/);
  assert.match(source, /onDoubleClick=\{\(event\) => event\.stopPropagation\(\)\}/);
  // Git 面板的仓库根是这一行自己的路径（子项目），不是项目根，标题里带完整路径。
  assert.match(source, /repositoryPath=\{node\.fullPath\}/);
  assert.match(source, /const title = `\$\{t\("files\.openGitPanel"\)\} · \$\{repositoryPath\}`;/);
});

test("the Git badge is forwarded through every nested TreeNode", () => {
  // 子目录的徽标同样可点：递归渲染处必须继续传下去，否则只有第一层能用。
  assert.equal(
    source.match(/onOpenRepositoryGitPanel=\{onOpenRepositoryGitPanel\}/g)?.length,
    2,
  );
});
