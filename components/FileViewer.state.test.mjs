import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import reactSyntaxHighlighter from "react-syntax-highlighter";

const source = await readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const { Prism: SyntaxHighlighter } = reactSyntaxHighlighter;

function functionBlock(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = nextName ? source.indexOf(`function ${nextName}(`, start) : source.length;
  assert.notEqual(start, -1, `${name} not found`);
  assert.notEqual(end, -1, `${nextName} not found after ${name}`);
  return source.slice(start, end);
}

for (const [name, nextName] of [
  ["ImageViewer", "formatDuration"],
  ["AudioViewer", "DocumentViewer"],
  ["DocumentViewer", "FileViewer"],
  ["TextFileViewer", null],
]) {
  test(`${name} pauses its watcher and synchronizes after connecting`, () => {
    const block = functionBlock(name, nextName);
    const guard = block.indexOf("if (!watchEnabled) return;");
    const eventSource = block.indexOf("new EventSource", guard);
    const synchronize = block.indexOf("synchronize();", eventSource);

    assert.ok(guard >= 0, "watchEnabled guard missing");
    assert.ok(eventSource > guard, "EventSource created before watchEnabled guard");
    assert.ok(synchronize > eventSource, "connected synchronization missing");
    assert.match(block, /\}, \[[^\]]*watchEnabled[^\]]*\]\);/);
  });
}

test("FileViewer forwards watcher state to every viewer implementation", () => {
  const block = functionBlock("FileViewer", "TextFileViewer");
  assert.equal(block.match(/watchEnabled=\{watchEnabled\}/g)?.length, 4);
});

test("TextFileViewer snapshots and restores lightweight tab state", () => {
  const block = functionBlock("TextFileViewer", null);
  assert.match(block, /onStateChangeRef\.current\?\.\(\{ \.\.\.viewerStateRef\.current \}\)/);
  assert.match(block, /displayMode: requestedInitialDisplayMode/);
  assert.match(block, /viewerStateRef\.current\.displayMode = nextDisplayMode/);
  assert.match(block, /viewerStateRef\.current\.wrapLines = next/);
  assert.match(block, /viewerStateRef\.current\.scrollTop = event\.currentTarget\.scrollTop/);
  assert.match(block, /viewerStateRef\.current\.scrollLeft = event\.currentTarget\.scrollLeft/);
  assert.match(block, /content\.scrollTop = viewerStateRef\.current\.scrollTop/);
  assert.match(block, /content\.scrollLeft = viewerStateRef\.current\.scrollLeft/);
});

test("first-mount default mode eligibility survives Strict Effects cleanup", () => {
  const block = functionBlock("TextFileViewer", null);
  assert.match(block, /defaultModeEligibleRef = useRef\(/);
  // 资格只在文件语言到达后才消费：data 未到时提前取走，Strict Effects 的重跑
  // 就会把首次挂载的默认模式丢掉。
  assert.match(block, /if \(!defaultModeEligibleRef\.current \|\| !data\?\.language\) return;/);
  assert.match(block, /defaultModeEligibleRef\.current = false;\s*const resolved = defaultOpenDisplayMode\(/);
  assert.match(block, /updateDisplayMode\(resolved\)/);
});

test("markdown opens as a rendered preview even when the viewer is editable", () => {
  const block = functionBlock("TextFileViewer", null);
  // 默认模式由 lib/file-viewer-state.ts 的 defaultOpenDisplayMode 裁决，
  // 组件不自己写 if (language === "markdown")。
  assert.doesNotMatch(block, /data\.language === "markdown"/);
  assert.match(block, /language: data\.language,/);
});

test("copying source or diff code excludes line-number gutters", () => {
  const block = functionBlock("copyFileViewerSelectionWithoutGutters", "SourceCodeRenderer");
  assert.match(block, /\.file-source-view, \.file-diff-view/);
  assert.match(block, /range\.cloneContents\(\)/);
  assert.match(block, /querySelectorAll\("\.file-viewer-copy-excluded"\)/);
  assert.match(block, /clipboardData\.setData\("text\/plain", text\)/);
  assert.match(block, /event\.preventDefault\(\)/);
  assert.match(source, /onCopy=\{copyFileViewerSelectionWithoutGutters\}/);
  assert.ok((source.match(/className="file-viewer-copy-excluded"/g) ?? []).length >= 3);
  assert.match(source, /WebkitUserSelect: "none"/);
});

test("source and diff line-number gutters stay fixed during horizontal scrolling", () => {
  assert.match(source, /const FILE_LINE_NUMBER_STYLE: CSSProperties = \{[\s\S]*position: "sticky",[\s\S]*left: 0,[\s\S]*zIndex: 1,[\s\S]*background: "var\(--bg-panel\)"/);
  assert.match(source, /lineNumberStyle=\{\{[\s\S]*\.\.\.FILE_LINE_NUMBER_STYLE/);
  assert.match(source, /style=\{FILE_LINE_NUMBER_STYLE\}/);
});

test("markdown table tokens stay inline despite Tailwind's table utility", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      SyntaxHighlighter,
      { language: "markdown" },
      "| Name | Desc |\n| --- | --- |\n| A | first |",
    ),
  );

  assert.match(html, /class="token table[ "]/);
  assert.match(cssSource, /span\.token\.table\s*\{[^}]*display:\s*inline;/);
});

test("TextFileViewer reveals the line a file link pointed at", () => {
  const block = functionBlock("TextFileViewer", null);

  assert.match(block, /pendingRevealLineRef = useRef<number \| null>\(initialLine \?\? null\)/);
  assert.match(block, /content\.querySelector<HTMLElement>\(`\[data-line-number="\$\{targetLine\}"\]`\)/);
  // 定位后把滚动位置写回 tab 状态，否则切回标签页会回到旧位置。
  assert.match(block, /viewerStateRef\.current\.scrollTop = content\.scrollTop/);
  assert.match(block, /setFlashLine\(targetLine\)/);
  assert.match(block, /onRevealHandledRef\.current\?\.\(\)/);

  // 高亮行由行渲染器打标记，预览/差异视图没有对应的行号坐标系。
  assert.match(source, /data-flash-line=\{isFlashLine \? "true" : undefined\}/);
  assert.match(block, /displayMode !== "source"/);
  assert.match(source, /initialLine=\{initialLine\}/);
  assert.match(source, /onRevealHandled=\{onRevealHandled\}/);
});

test("a diff hint on a clean file falls back to that file's own default mode", () => {
  // 对话里的文件链接一律以 diff 起步，但文件没有未提交改动时必须退回默认模式：
  // 硬编码 source 会让一条指向未改动 markdown 的链接失去预览，也让可编辑文件
  // 丢掉了它一贯的编辑器。语言要等内容回来才知道，所以 data 未到就先等。
  assert.match(
    source,
    /if \(!gitDiffResolved \|\| hasGitDiff \|\| displayMode !== "diff" \|\| !data\) return;/,
  );
  assert.match(
    source,
    /updateDisplayMode\(defaultOpenDisplayMode\(\{\s*\n\s*editable,\s*\n\s*language: data\.language,\s*\n\s*openedWithLine: openedWithLineRef\.current,/,
  );
  assert.doesNotMatch(source, /displayMode === "diff"\) updateDisplayMode\("source"\)/);
});

test("settling the diff hint keeps a later external change out of the view", () => {
  // 回退到默认模式时就把 autoDiffApplied 打上：否则这个文件之后在磁盘上被改出
  // 差异（watch 重新拉 diff）会把正在读/正在改的人突然拽进 diff。
  assert.match(
    source,
    /autoDiffAppliedRef\.current = true;\s*\n\s*updateDisplayMode\(defaultOpenDisplayMode\(\{/,
  );
});

test("a diff-first viewer waits for the git result instead of flashing the whole file", () => {
  assert.match(
    source,
    /if \(loading \|\| \(requestedInitialDisplayMode === "diff" && !gitDiffResolved\)\) \{/,
  );
});
