import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { MobileThinking, MobileToolList } = await jiti.import("./MobileProcessParts.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const source = await readFile(new URL("./MobileProcessParts.tsx", import.meta.url), "utf8");

function render(node) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, node));
}

const call = (overrides = {}) => ({ id: "t1", name: "read", hint: "src/a.ts", ...overrides });

test("labels the thinking text so it is not mistaken for the answer", () => {
  const html = render(React.createElement(MobileThinking, { text: "先读文件再改" }));

  assert.match(html, /Thinking</);
  assert.match(html, /先读文件再改/);
  // 思考用 muted 文字，和正文分开。
  assert.match(html, /color:var\(--text-muted\)/);
});

test("shows one collapsed row per tool call", () => {
  const html = render(React.createElement(MobileToolList, { calls: [call(), call({ id: "t2", name: "bash", hint: "npm test" })] }));

  assert.match(html, />read</);
  assert.match(html, />src\/a\.ts</);
  assert.match(html, />bash</);
  assert.match(html, />npm test</);
  // 默认收起：入参和结果都不在 DOM 里。
  assert.doesNotMatch(html, /ENOENT|"path"/);
});

test("keeps rows without details unclickable", () => {
  const html = render(React.createElement(MobileToolList, { calls: [call()] }));

  assert.doesNotMatch(html, /<button/);
  assert.doesNotMatch(html, /aria-expanded/);
});

test("makes rows with input or output expandable", () => {
  const html = render(React.createElement(MobileToolList, { calls: [call({ input: "{\n  \"path\": \"src/a.ts\"\n}", output: "ENOENT: no such file" })] }));

  assert.match(html, /<button[^>]*aria-expanded="false"/);
  assert.match(html, /mobile-disclosure-chevron/);
  // 收起状态下细节不渲染，展开逻辑在点击里。
  assert.doesNotMatch(html, /ENOENT/);
});

test("colours failed tools with the danger token", () => {
  const html = render(React.createElement(MobileToolList, { calls: [call({ isError: true, output: "boom" })] }));

  assert.match(html, /color:var\(--danger\)/);
});

test("keeps the details scroll capped so one huge result cannot blow up the page", () => {
  assert.match(source, /maxHeight: 220/);
  assert.match(source, /maxHeight: 280/);
  assert.match(source, /overflow: "auto"/);
});

test("stays a thin client component", () => {
  const importLines = source.split("\n").filter((line) => /^\s*import\b/.test(line)).join("\n");

  assert.match(source, /^"use client";/);
  for (const heavy of ["MarkdownBody", "react-markdown", "react-syntax-highlighter", "mermaid"]) {
    assert.doesNotMatch(importLines, new RegExp(heavy.replace(/[/.]/g, "\\$&")), `${heavy} must not load here`);
  }
});
