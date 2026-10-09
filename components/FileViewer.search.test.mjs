import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

function functionBlock(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = nextName ? source.indexOf(`function ${nextName}(`, start) : source.length;
  assert.notEqual(start, -1, `${name} not found`);
  assert.notEqual(end, -1, `${nextName} not found after ${name}`);
  return source.slice(start, end);
}

test("SourceCodeRenderer wraps search matches without touching the token tree", () => {
  const block = functionBlock("SourceCodeRenderer", "getFileApiUrl");

  assert.match(source, /highlightSyntaxNodes,\s*\n\s*type LineSearchRange,/);
  assert.match(source, /lineSearchRanges\?: Map<number, LineSearchRange\[\]>/);
  assert.match(block, /const ranges = lineSearchRanges\?\.get\(lineIndex \+ 1\)/);
  assert.match(block, /highlightSyntaxNodes\([\s\S]*ranges,[\s\S]*activeSearchIndex,?[\s\S]*\)/);
  assert.match(source, /lineSearchRanges=\{searchOpen \? lineSearchRanges : undefined\}/);
  assert.match(source, /activeSearchIndex=\{activeMatchIndex\}/);
});

test("TextFileViewer owns search state, matching, and navigation", () => {
  const block = functionBlock("TextFileViewer", null);

  assert.match(block, /const \[searchOpen, setSearchOpen\] = useState\(false\)/);
  assert.match(block, /const \[searchQuery, setSearchQuery\] = useState\(""\)/);
  assert.match(block, /const \[searchCaseSensitive, setSearchCaseSensitive\] = useState\(false\)/);
  assert.match(block, /findFileSearchMatches\(content, searchQuery, searchCaseSensitive\)/);
  assert.match(block, /buildLineSearchRangeMap\(searchMatches\)/);
  assert.match(block, /const stepMatch = useCallback\(\(delta: number\)/);
  assert.match(block, /const closeSearch = useCallback\(\(\) => \{[\s\S]*setSearchQuery\(""\)/);
});

test("TextFileViewer binds Cmd/Ctrl+F, Enter, Shift+Enter, and Escape", () => {
  const block = functionBlock("TextFileViewer", null);

  assert.match(block, /event\.key\.toLowerCase\(\) !== "f"/);
  assert.match(block, /shell\.contains\(document\.activeElement\)/);
  assert.match(block, /!pointerInsideRef\.current\) return/);
  assert.match(block, /stepMatch\(event\.shiftKey \? -1 : 1\)/);
  assert.match(block, /event\.key === "Escape"[\s\S]*closeSearch\(\)/);
});

test("TextFileViewer scrolls the active match into view and persists scroll state", () => {
  const block = functionBlock("TextFileViewer", null);

  assert.match(block, /const active = searchMatches\[activeMatchIndex\]/);
  assert.match(block, /querySelector<HTMLElement>\(`\[data-line-number="\$\{active\.line\}"\]`\)/);
  assert.match(block, /querySelector<HTMLElement>\("\.file-search-match\.is-active"\)/);
  assert.match(block, /viewerStateRef\.current\.scrollLeft = container\.scrollLeft/);
});

test("search bar exposes prev/next, case toggle, and close controls", () => {
  assert.match(source, /className="file-viewer-search"/);
  assert.match(source, /className="file-viewer-search-input"/);
  assert.match(source, /<ChevronUp size=\{14\}/);
  assert.match(source, /<ChevronDown size=\{14\}/);
  assert.match(source, /<CaseSensitive size=\{15\}/);
  assert.match(source, /<X size=\{14\}/);
  assert.match(source, /aria-label=\{t\("i18n\.findInFile"\)\}/);
});

test("search highlight styling is theme-driven and marks the active match", () => {
  assert.match(cssSource, /\.file-search-match\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--accent\) 28%, transparent\)/);
  assert.match(cssSource, /\.file-search-match\.is-active\s*\{[^}]*background:\s*var\(--accent\)/);
  assert.match(cssSource, /\.file-viewer-search-input\s*\{[^}]*font-family:\s*var\(--font-mono\)/);
});

test("search input centres its placeholder inside the fixed-height box", () => {
  // 24px 高、上下各 1px 边框 → 内容区 22px，行高必须等于它，否则 placeholder 偏上。
  assert.match(cssSource, /\.file-viewer-search-input\s*\{[^}]*height:\s*24px;[^}]*line-height:\s*22px;/);
  assert.doesNotMatch(cssSource, /\.file-viewer-search-input\s*\{[^}]*line-height:\s*1;/);
});
