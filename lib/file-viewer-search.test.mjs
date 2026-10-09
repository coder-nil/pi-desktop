import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  buildLineSearchRangeMap,
  escapeRegExp,
  findFileSearchMatches,
  highlightSyntaxNodes,
} = await jiti.import("./file-viewer-search.ts");

test("findFileSearchMatches is literal, case-insensitive, and reports line/offset", () => {
  const content = ["const Foo = foo(1);", "let bar = 2;"].join("\n");

  assert.deepEqual(findFileSearchMatches(content, "foo", false), [
    { line: 1, start: 6, end: 9 },
    { line: 1, start: 12, end: 15 },
  ]);
  assert.deepEqual(findFileSearchMatches(content, "foo", true), [
    { line: 1, start: 12, end: 15 },
  ]);
  assert.deepEqual(findFileSearchMatches(content, "", false), []);
});

test("findFileSearchMatches treats regex metacharacters as plain text", () => {
  const content = "call(a.b); let c = a.b; // a+b";
  const matches = findFileSearchMatches(content, "a.b", false);

  assert.deepEqual(matches, [
    { line: 1, start: 5, end: 8 },
    { line: 1, start: 19, end: 22 },
  ]);
  assert.equal(escapeRegExp("a.b+"), "a\\.b\\+");
});

test("findFileSearchMatches handles repeated and adjacent hits without looping", () => {
  assert.deepEqual(findFileSearchMatches("aaaa", "aa", false), [
    { line: 1, start: 0, end: 2 },
    { line: 1, start: 2, end: 4 },
  ]);
});

test("buildLineSearchRangeMap groups ranges per line and keeps global indices", () => {
  const matches = findFileSearchMatches("foo bar foo\nfoo", "foo", false);
  const ranges = buildLineSearchRangeMap(matches);

  assert.deepEqual(ranges.get(1), [
    { start: 0, end: 3, index: 0 },
    { start: 8, end: 11, index: 1 },
  ]);
  assert.deepEqual(ranges.get(2), [{ start: 0, end: 3, index: 2 }]);
  assert.equal(ranges.get(3), undefined);
});

test("highlightSyntaxNodes splits text and wraps matches in a <mark>", () => {
  const ranges = buildLineSearchRangeMap(findFileSearchMatches("abc", "b", false)).get(1);
  const nodes = highlightSyntaxNodes([{ type: "text", value: "abc\n" }], ranges, 0);

  assert.deepEqual(nodes, [
    { type: "text", value: "a" },
    {
      type: "element",
      tagName: "mark",
      properties: { className: ["file-search-match", "is-active"] },
      children: [{ type: "text", value: "b" }],
    },
    // The trailing newline survives the rewrite.
    { type: "text", value: "c\n" },
  ]);
});

test("highlightSyntaxNodes carries a match across token boundaries", () => {
  const ranges = buildLineSearchRangeMap(findFileSearchMatches("foobar", "oba", false)).get(1);
  const nodes = highlightSyntaxNodes([
    { type: "element", tagName: "span", properties: { className: ["token", "keyword"] }, children: [{ type: "text", value: "foo" }] },
    { type: "element", tagName: "span", properties: { className: ["token"] }, children: [{ type: "text", value: "bar" }] },
  ], ranges, 0);

  assert.deepEqual(nodes[0].children, [
    { type: "text", value: "fo" },
    {
      type: "element",
      tagName: "mark",
      properties: { className: ["file-search-match", "is-active"] },
      children: [{ type: "text", value: "o" }],
    },
  ]);
  assert.deepEqual(nodes[1].children, [
    {
      type: "element",
      tagName: "mark",
      properties: { className: ["file-search-match", "is-active"] },
      children: [{ type: "text", value: "ba" }],
    },
    { type: "text", value: "r" },
  ]);
});

test("highlightSyntaxNodes leaves non-active matches unmarked as active", () => {
  const ranges = buildLineSearchRangeMap(findFileSearchMatches("foo foo", "foo", false)).get(1);
  const nodes = highlightSyntaxNodes([{ type: "text", value: "foo foo" }], ranges, 1);
  const marks = nodes.filter((node) => node.tagName === "mark");

  assert.equal(marks.length, 2);
  assert.deepEqual(marks[0].properties.className, ["file-search-match"]);
  assert.deepEqual(marks[1].properties.className, ["file-search-match", "is-active"]);
});
