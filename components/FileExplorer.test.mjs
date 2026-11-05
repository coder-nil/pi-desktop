import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");
const revealSource = await readFile(new URL("./RevealFileButton.tsx", import.meta.url), "utf8");
const globalStyles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

/** 目录行右侧操作区（`.file-row-actions` 到它自己的闭合 </div>），不含周围的行内块。 */
function actionGroupSource() {
  const start = source.indexOf('className="file-row-actions"');
  const end = source.indexOf("\n          </div>\n        )}", start);
  assert.ok(start >= 0 && end > start, "action group markup must be found");
  return source.slice(start, end);
}


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

test("a sub-project directory offers a Git button after the mention button", () => {
  // 一个项目目录里可以有多个各自带 .git 的子项目：服务端的 `gitRepository`
  // 一路带到节点上，按钮与「提及 / 在访达中显示」同属行右侧的 hover 操作区，
  // 顺序是 提及 → Git → 在访达中显示。
  assert.match(source, /gitRepository\?: boolean;/);
  assert.match(source, /\.\.\.\(e\.gitRepository \? \{ gitRepository: true \} : \{\}\),/);

  const actions = actionGroupSource();
  // 提及按钮只显示 @ 符号（文字标签留在 aria-label / title 里），Git 排在它后面。
  const mentionButton = actions.indexOf('aria-label={t("files.mention")}');
  assert.ok(mentionButton >= 0, "mention button belongs to the action row");
  const gitButton = actions.indexOf("<GitRepositoryButton");
  assert.match(
    actions.slice(mentionButton, gitButton),
    /<AtSign size=\{14\} strokeWidth=\{2\} aria-hidden="true" \/>/,
    "mention button body is the @ glyph",
  );
  assert.ok(gitButton > mentionButton, "Git button must come after the mention button");
  assert.ok(gitButton < actions.indexOf("<RevealFileButton"), "Git button must come before the reveal button");
  assert.match(actions, /\{node\.isDir && node\.gitRepository && onOpenRepositoryGitPanel && \(/);

  // 它不再是目录图标旁的常驻徽标：点击也只是打开 Git 面板，不展开/收起、不进入重命名。
  assert.doesNotMatch(source, /GitRepositoryBadge/);
  assert.match(source, /onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);\s*onOpen\(repositoryPath\);\s*\}\}/);
  assert.match(source, /onDoubleClick=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(source, /repositoryPath=\{node\.fullPath\}/);
  // 面板标题与无障碍名都带路径，鼠标悬停就知道是哪个仓库。
  assert.match(source, /title=\{`\$\{t\("files\.openGitPanel"\)\} · \$\{repositoryPath\}`\}/);
  assert.match(source, /aria-label=\{`\$\{t\("files\.openGitPanel"\)\}: \$\{name\}`\}/);
});

test("the Git button is forwarded through every nested TreeNode", () => {
  // 子目录的按钮同样可点：递归渲染处必须继续传下去，否则只有第一层能用。
  assert.equal(
    source.match(/onOpenRepositoryGitPanel=\{onOpenRepositoryGitPanel\}/g)?.length,
    2,
  );
});

test("every mention button shows the @ glyph instead of the word", () => {
  // 「提及」两个字只留在 title / aria-label 里，按钮正文统一是 @ 图标。
  assert.doesNotMatch(source, /<MentionIcon \/>\s*\n\s*\{t\("files\.mention"\)\}/);
  assert.doesNotMatch(source, /\n\s*@\n/);
  assert.equal(
    source.match(/<AtSign size=\{14\} strokeWidth=\{2\} aria-hidden="true" \/>/g)?.length,
    2,
  );
});

test("the row actions share one icon language", () => {
  // 三个按钮必须是同一种图标：lucide 线性图标（14px / strokeWidth 2 / currentColor），
  // 不要混 catppuccin 的遮罩图标，也不要用字体画出来的 @ 字符。
  const actions = actionGroupSource();
  assert.match(source, /import \{ AtSign, GitBranch \} from "lucide-react";/);
  assert.match(actions, /<AtSign size=\{14\} strokeWidth=\{2\} aria-hidden="true" \/>/);
  // Git 按钮的图标在组件体内，与提及同一个尺寸 / 线宽。
  assert.match(source, /<GitBranch size=\{14\} strokeWidth=\{2\} aria-hidden="true" \/>/);
  assert.match(actions, /<GitRepositoryButton/);
  assert.doesNotMatch(source, /GitRepositoryIcon/);
  // 在访达按钮是同样的 14px / strokeWidth 2 线性图标。
  assert.match(revealSource, /<svg width="14" height="14"[^>]*strokeWidth="2"/);
  // 提及与 Git 按钮共用 --text-muted：一排里不再有一个强调色的例外。
  const mutedColors = actions.match(/color: "var\(--text-muted\)"/g) ?? [];
  assert.ok(mutedColors.length >= 2, "mention and Git buttons share the muted icon color");
});

test("the row action buttons sit flush against each other", () => {
  // 三个按钮拼成一组：容器不留 gap，按钮自己的内联样式也不写 border-radius，
  // 由 globals.css 的 .file-row-actions 规则把相邻边框叠成 1px 分隔线。
  const actions = actionGroupSource();
  const groupTag = actions.slice(0, actions.indexOf(">"));
  assert.doesNotMatch(groupTag, /\bgap:/, "the action group must not space its buttons apart");
  assert.doesNotMatch(actions, /borderRadius/, "radius comes from the group rules, not inline");
  assert.match(globalStyles, /\.file-row-actions > button \{\s*\n\s*border-radius: 0;/);
  assert.match(globalStyles, /\.file-row-actions > button \+ button \{\s*\n\s*margin-left: -1px;/);
  assert.match(globalStyles, /\.file-row-actions > button:first-child \{[\s\S]*?border-top-left-radius: 4px;/);
  assert.match(globalStyles, /\.file-row-actions > button:last-child \{[\s\S]*?border-top-right-radius: 4px;/);
});
