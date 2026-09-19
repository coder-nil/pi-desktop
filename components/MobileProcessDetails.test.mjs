import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { MobileProcessDetails } = await jiti.import("./MobileProcessDetails.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const source = await readFile(new URL("./MobileProcessDetails.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

function render(props, children = React.createElement("span", null, "PROCESS_BODY")) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(MobileProcessDetails, props, children)),
  );
}

test("starts collapsed and hides the details", () => {
  const html = render({ messageCount: 2, toolCallCount: 5 });

  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /PROCESS_BODY/);
  // 收起时只有摘要那一行，不再渲染详情容器。
  assert.equal(html.match(/<div /g)?.length, 1);
  assert.doesNotMatch(html, /margin-top:8px/);
});

test("reads exactly like the desktop group summary", () => {
  const html = render({ messageCount: 2, toolCallCount: 5 });

  assert.match(html, /Process details · 2 messages · 5 tool calls/);
  assert.match(html, /title="Expand process details"/);
});

test("pluralizes single counts and drops the zero parts", () => {
  assert.match(render({ messageCount: 1, toolCallCount: 1 }), /Process details · 1 message · 1 tool call</);
  assert.match(render({ messageCount: 0, toolCallCount: 3 }), /Process details · 3 tool calls</);
  assert.match(render({ messageCount: 0, toolCallCount: 0 }), /Process details<\/span>/);
});

test("shows the details when explicitly expanded", () => {
  const html = render({ messageCount: 1, toolCallCount: 1, defaultExpanded: true });

  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /PROCESS_BODY/);
  assert.match(html, /title="Collapse process details"/);
  // 展开时 chevron 旋成朝下。
  assert.match(html, /transform:rotate\(90deg\)/);
});

test("is expanded while the turn is running and collapses when it ends", () => {
  // 在跑的那一轮默认展开（不用额外传 defaultExpanded）。
  assert.match(render({ messageCount: 2, toolCallCount: 3, running: true }), /aria-expanded="true"/);
  assert.match(render({ messageCount: 2, toolCallCount: 3, running: true }), /PROCESS_BODY/);
  // 跑完（running 变回 false）由 effect 折回去，而不是重挂组件。
  assert.match(source, /const \[expanded, setExpanded\] = useState\(defaultExpanded \|\| running\)/);
  assert.match(source, /useEffect\(\(\) => \{\s*\n\s*setExpanded\(running\);\s*\n\s*\}, \[running\]\);/);
});

test("keeps the chevron transition inside the reduced-motion guard", () => {
  assert.match(cssSource, /\.mobile-disclosure-chevron \{\s*transition: transform 150ms ease-out;\s*\}/);
  assert.match(cssSource, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.mobile-disclosure-chevron \{ transition: none; \}/);
});

test("stays a client leaf that does not drag in the desktop renderers", () => {
  const importLines = source.split("\n").filter((line) => /^\s*import\b/.test(line)).join("\n");

  assert.match(source, /^"use client";/);
  for (const heavy of ["MarkdownBody", "MermaidBlock", "react-markdown", "react-syntax-highlighter"]) {
    assert.doesNotMatch(importLines, new RegExp(heavy.replace(/[/.]/g, "\\$&")), `${heavy} must not load here`);
  }
});
