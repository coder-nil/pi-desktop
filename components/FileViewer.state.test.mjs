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

test("TextFileViewer keeps first-mount preview eligibility across Strict Effects cleanup", () => {
  const block = functionBlock("TextFileViewer", null);
  assert.match(block, /defaultPreviewEligibleRef = useRef\(/);
  assert.match(block, /defaultPreviewEligibleRef\.current[\s\S]*updateDisplayMode\("preview"\)/);
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
