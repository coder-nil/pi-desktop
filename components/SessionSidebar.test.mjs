import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const sessionItemSource = source.slice(source.indexOf("function SessionItem("));

test("only Shift+click bypasses session deletion confirmation", () => {
  assert.match(
    sessionItemSource,
    /const handleDeleteClick[\s\S]*?if \(e\.shiftKey\) \{\s*void performDelete\(\);\s*\} else \{\s*setConfirmDelete\(true\);/,
  );
});

test("does not register row-level session deletion shortcuts", () => {
  assert.doesNotMatch(sessionItemSource, /const handleKeyDown/);
  assert.doesNotMatch(sessionItemSource, /onKeyDown=\{handleKeyDown\}/);
  assert.doesNotMatch(sessionItemSource, /tabIndex=\{0\}/);
});

test("uses SSE in the background and polling while the tab is visible", () => {
  assert.match(source, /new EventSource\("\/api\/agent\/running\/events"\)/);
  assert.match(source, /setRunningSessionIds\(new Set\(data\.runningSessionIds \?\? \[\]\)\)/);
  assert.match(source, /onBackgroundTaskDone\?\.\([\s\S]*?completedInBackground/);
  assert.match(source, /fetch\("\/api\/agent\/running"/);
  assert.match(source, /document\.visibilityState !== "visible"/);
  assert.match(source, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
});

test("exposes the polled running-session set to the shell", () => {
  assert.match(source, /onRunningSessionIdsChange\?: \(ids: Set<string>\) => void/);
  assert.match(source, /onRunningSessionIdsChange\?\.\(runningSessionIds\)/);
});

test("includes project activity counts in accessible labels", () => {
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.agentRunning"\)\} \(\$\{activity\.running\}\)`\}/,
  );
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.newSessionActivity"\)\} \(\$\{activity\.unread\}\)`\}/,
  );
});

test("surfaces pending ask_user prompts on the project selector", () => {
  assert.match(source, /pendingUiSessionIds/);
  assert.match(
    source,
    /getProjectActivity\(allSessions, runningSessionIds, unreadSessionIds, pendingUiSessionIds\)/,
  );
  assert.match(source, /title=\{t\("sidebar\.waitingForUser"\)\}/);
  assert.match(source, /aria-label=\{`\$\{t\("sidebar\.waitingForUser"\)\} \(\$\{activity\.awaiting\}\)`\}/);
  assert.match(source, /<Speech size=\{10\} strokeWidth=\{2\.5\}/);
});

test("does not persist an unchanged fallback title ending in whitespace", () => {
  assert.match(
    sessionItemSource,
    /const name = renameValue\.trim\(\);[\s\S]*?if \(renameValue === title \|\| name === \(session\.name \?\? ""\)\) return;/,
  );
});

test("offers the downstream context-menu hook only on a normal session row", () => {
  assert.match(sessionItemSource, /const handleContextMenu[\s\S]*?dispatchSessionRowContextMenu\(\{/);
  assert.match(
    sessionItemSource,
    /onContextMenu=\{confirmDelete \|\| renaming \? undefined : handleContextMenu\}/,
  );
});

test("manual and lifecycle refreshes bypass the server session-list cache", () => {
  assert.match(source, /force \? "\/api\/sessions\?force=1" : "\/api\/sessions"/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /loadSessions\(isFirst, !isFirst\)/);
  assert.match(source, /onClick=\{\(\) => loadSessions\(false, true\)\}/);
  assert.match(source, /loadSessions\(false, true\);[\s\S]*?onBackgroundTaskDone/);
});

test("does not expose disk-backed actions for transient sessions", () => {
  assert.match(sessionItemSource, /if \(session\.transient\) return;/);
  assert.match(sessionItemSource, /\{\(hovered \|\| titleStatus\) && !session\.transient && \(/);
});

test("offers the custom path picker beside the project path field", () => {
  assert.match(source, /aria-label=\{t\("sidebar\.customPath"\)\}[\s\S]*?handleCustomPathClick\(\)/);
  assert.match(source, /M15\.5 10\.5v5M13 13h5/);
});

test("hides the branch selector after a project resolves as non-Git", () => {
  assert.match(source, /const worktreeGuide = selectedCwd\s*&& worktreeState\?\.isGit/);
  assert.doesNotMatch(source, /label: t\("sidebar\.gitRepoRootOnly"\)/);
});

test("reports the selected project's resolved Git state to the shell", () => {
  assert.match(source, /onProjectGitStateChange\?: \(isGit: boolean \| null\) => void/);
  assert.match(source, /worktreeState\?\.forCwd === selectedCwd \? worktreeState\.isGit : null/);
});

test("persists successfully added projects through the server directory list", () => {
  assert.match(source, /fetch\("\/api\/projects", \{ cache: "no-store", signal: controller\.signal \}\)/);
  assert.match(source, /setAddedProjects\(\(previous\) => \{/);
  assert.match(source, /\.\.\.previous\.filter\(\(project\) => project\.projectKey !== addedProject\.projectKey\)/);
  assert.match(source, /fetch\("\/api\/projects", \{[\s\S]*?method: "DELETE"/);
  assert.match(source, /handleRemoveProject\(\s*project\.key,/);
  assert.match(source, /project\.key === selectedProject\?\.key/);
  assert.match(source, /visibleProjects\[index \+ 1\]\?\.root/);
});

test("searches conversation content across projects with stale-request cancellation", () => {
  assert.match(source, /fetch\(`\/api\/sessions\/search\?\$\{params\}`/);
  assert.match(source, /const controller = new AbortController\(\)/);
  assert.match(source, /controller\.abort\(\)/);
  assert.match(source, /sessionSearchResult\.query === sessionSearch\.trim\(\)/);
  assert.match(source, /normalizedSessionSearch\s*\? allSessions\.filter/);
  assert.match(source, /searchMatches=\{sessionSearchMatchMap\}/);
});

test("falls back to the user home directory when no project is selected", () => {
  assert.match(
    source,
    /<DirectoryPicker[\s\S]*?initialPath=\{selectedProject\?\.root \?\? homeDir\}/,
  );
});

test("centers the sidebar title row against the chat top bar", () => {
  assert.match(source, /import \{ CHAT_TOP_BAR_HEIGHT \} from "@\/lib\/panel-layout";/);
  // 上边距改由标题行自身高度承担，否则标题会比工具栏低 6px。
  assert.match(source, /padding: "0 10px 10px",/);
  assert.doesNotMatch(source, /padding: "12px 10px 10px"/);
  assert.match(
    source,
    /<div\s+style=\{\{\s*display: "flex",\s*alignItems: "center",\s*gap: 6,\s*minHeight: CHAT_TOP_BAR_HEIGHT,\s*marginBottom: 10,\s*\}\}\s*>\s*<PiWebTitle onAboutClick=\{onAboutClick\} \/>/,
  );
});

test("the explorer header row keeps a fixed height so it looks even when collapsed", () => {
  // 收起时标题行就是整个区块的高度：padding 撑出来的高度会随行高浮动，且比
  // 相邻搜索栏窄一线。改成固定高度 + 按钮撑满。
  assert.match(source, /const HEADER_ROW_HEIGHT = 32;/);
  assert.match(source, /const \{ t \} = useI18n\(\);/);
  assert.match(
    source,
    /<div style=\{\{ display: "flex", alignItems: "center", flexShrink: 0, height: HEADER_ROW_HEIGHT \}\}>/,
  );
  assert.match(source, /height: "100%",\s*\n\s*padding: "0 10px",/);
  assert.doesNotMatch(source, /padding: "6px 10px",\s*\n\s*background: "none",/);
  // 展开/收起状态要报给辅助技术。
  assert.match(source, /aria-expanded=\{explorerOpen\}/);
});

test("the Git panel entry sits on the branch row, not only in the bottom bar", () => {
  // Git 面板入口和仓库名 / 拉取 / 推送同属一组，放在分支这一行；只在底部存在
  // 那个按钮时才渲染（网页版没有 Git 面板，不要凭空多一个入口）。
  assert.match(source, /const showBranchGitButton = Boolean\(showWorktreeSwitcher && onOpenGitPanel\);/);
  assert.match(source, /\{showBranchGitButton && \(/);
  assert.match(source, /onClick=\{\(event\) => \{ event\.stopPropagation\(\); onOpenGitPanel\?\.\(\); \}\}/);
  assert.match(source, /aria-pressed=\{gitPanelOpen === true\}/);
  // 三个按钮不能重叠：Git 在最右，push / pull 随之右移一格。
  assert.match(source, /right: showBranchGitButton \? 28 : 0,/);
  assert.match(source, /right: showBranchGitButton \? 56 : 28,/);
  assert.match(source, /padding: showBranchGitButton \? "0 100px 0 10px" : "0 72px 0 10px",/);
});

test("project rows can be starred and starred projects are listed first", () => {
  // 星标是项目记录上的一列（不是浏览器偏好），所以排序也在同一份数据上做；
  // 排序规则要和 lib/added-projects-store.ts 的 SQL 一致，否则点星后的落点和
  // 刷新后的位置会不一样。
  assert.match(source, /Number\(b\.starred\) - Number\(a\.starred\) \|\| b\.addedAt\.localeCompare\(a\.addedAt\)/);
  assert.match(source, /starred: project\.starred === true,/);
  // 点星星只切收藏，不能顺带切换项目。
  assert.match(
    source,
    /onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);\s*void handleToggleProjectStar\(project\.key, !project\.starred\);/,
  );
  assert.match(source, /fetch\("\/api\/projects", \{\s*method: "PATCH",/);
  // 写入失败要回滚，列表不能显示一个没有存下来的状态。
  assert.match(source, /if \(response\.ok\) return;[\s\S]{0,200}?apply\(!starred\);/);
  assert.match(source, /className="project-row-icon-button project-star-button"/);
  assert.match(source, /data-starred=\{project\.starred \? "true" : "false"\}/);
  assert.match(source, /aria-pressed=\{project\.starred\}/);
  assert.match(source, /fill=\{project\.starred \? "currentColor" : "none"\}/);
  assert.match(source, /t\("sidebar\.starProject", \{ path: project\.root \}\)/);
  assert.match(source, /t\("sidebar\.unstarProject", \{ path: project\.root \}\)/);
});

test("the project row hover style only paints the background", () => {
  // CSS 侧同样锁住：只有 .project-row:hover 改背景色，不存在「行 hover 影响
  // 子元素」的规则（那会让行内图标淡入/变亮，等于 hover 时内部元素发生变化）。
  assert.match(styles, /\.project-row:hover \{\s*background: var\(--bg-hover\);\s*\}/);
  assert.doesNotMatch(styles, /\.project-row:hover[^{]*\{[^}]*opacity/);
  assert.doesNotMatch(styles, /\[data-project-row\]:hover/);
});

test("hovering a project row never changes what is inside it", () => {
  // 行 hover 只能改行自己的背景（.project-row:hover）。以前 hover 会把
  // margin 从 "3px 0" 改成 "3px 5px"（整行内容左右位移）、把移除按钮从
  // opacity 0 淡入、并让未收藏星标提亮——读起来像列表在抖。这里锁住：
  // 行上没有 hover 处理器，选中也不是靠内联 margin/background 切换的。
  const rowStart = source.indexOf('className="project-row"');
  assert.notEqual(rowStart, -1);
  const rowBlock = source.slice(Math.max(0, rowStart - 400), rowStart + 400);
  assert.doesNotMatch(rowBlock, /onMouseEnter/);
  assert.doesNotMatch(rowBlock, /onMouseLeave/);
  assert.doesNotMatch(rowBlock, /data-remove-btn\)\.style/);
  // 行内图标按钮常驻显示，不带 opacity/pointerEvents 的显隐切换。
  assert.doesNotMatch(source, /opacity: 0, pointerEvents: "none"/);
  assert.match(source, /className="project-row-icon-button project-remove-button"/);
  assert.match(source, /data-selected=\{project\.key === selectedProject\?\.key \? "true" : "false"\}/);
  // 选中行与未选中行占位一致：行样式统一由 .project-row 提供。
  assert.doesNotMatch(source, /margin: project\.key === selectedProject\?\.key \? "3px 5px" : "3px 0"/);
});

test("the file explorer header swaps its chevron for a spinner while loading", () => {
  // 标题行的箭头在根目录列表请求期间变成转圈；收起时不显示转圈（此时没有请求）。
  assert.match(
    source,
    /aria-expanded=\{explorerOpen\}[\s\S]*?\{explorerOpen && explorerLoading \? \(\s*<TreeLoadingSpinner size=\{9\} label=\{t\("files\.loading"\)\} \/>\s*\) : \(/,
  );
  assert.match(source, /import \{ FileExplorer, TreeLoadingSpinner, type FileExplorerHandle \} from "\.\/FileExplorer"/);
  assert.match(source, /onLoadingChange=\{setExplorerLoading\}/);
  assert.match(source, /const \[explorerLoading, setExplorerLoading\] = useState\(false\)/);
});
