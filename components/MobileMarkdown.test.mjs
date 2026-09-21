import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { MobileMarkdown } = await jiti.import("./MobileMarkdown.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const source = await readFile(new URL("./MobileMarkdown.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

function render(text, props = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MobileMarkdown, { text, cwd: "/home/me/project", ...props }),
    ),
  );
}

test("renders headings, lists, emphasis and inline code", () => {
  const html = render("# 标题\n\n**粗体** 与 *斜体* 与 `code()`\n\n- 一\n- 二\n\n1. 甲\n2. 乙");

  assert.match(html, /<h1>标题<\/h1>/);
  assert.match(html, /<strong>粗体<\/strong>/);
  assert.match(html, /<em>斜体<\/em>/);
  assert.match(html, /<code class="markdown-inline-code">code\(\)<\/code>/);
  assert.match(html, /<ul>[\s\S]*?<li>一<\/li>/);
  assert.match(html, /<ol>[\s\S]*?<li>甲<\/li>/);
});

test("renders fenced code without pulling in a syntax highlighter", () => {
  const html = render("```ts\nconst answer = 42;\n```");

  assert.match(html, /class="markdown-code-block"/);
  assert.match(html, /class="markdown-code-lang">ts</);
  assert.match(html, /<pre[^>]*><code[^>]*>const answer = 42;<\/code><\/pre>/);
  // 语言标签 + 复制按钮是代码块仅有的两块外壳。
  assert.match(html, />Copy<\/button>/);
  assert.doesNotMatch(html, /class="token|hljs|prism|shiki/i);
});

test("keeps code blocks on one wrapper instead of nesting <pre> twice", () => {
  const html = render("```js\nlet a = 1;\n```");

  assert.equal(html.match(/<pre/g)?.length, 1);
  assert.equal(html.match(/<\/pre>/g)?.length, 1);
});

test("renders GFM tables inside a scrollable wrapper", () => {
  const html = render("| a | b |\n| - | - |\n| 1 | 2 |");

  assert.match(html, /class="markdown-table-wrap"/);
  assert.match(html, /<th>a<\/th>/);
  assert.match(html, /<td>2<\/td>/);
});

test("opens web links in a safe new tab and makes local file links inert", () => {
  const web = render("[docs](https://example.com/docs)");
  assert.match(web, /<a (?=[^>]*href="https:\/\/example\.com\/docs")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")[^>]*>docs<\/a>/);
  assert.doesNotMatch(web, /\snode=/);

  // 手机打不开本机文件：降级成文本，不能把遥控页导到 404。
  const local = render("[components/MobileMarkdown.tsx](components/MobileMarkdown.tsx)");
  assert.match(local, /components\/MobileMarkdown\.tsx/);
  assert.doesNotMatch(local, /<a /);
});

test("resolves relative image paths through the file API", () => {
  const html = render("![shot](./shots/a.png)");

  assert.match(html, /src="\/api\/files\/[^"]*shots\/a\.png\?type=read"/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /alt="shot"/);
});

test("keeps CJK single-tilde ranges literal instead of striking them", () => {
  const html = render("5~7U 保证金 × 100~200倍杠杆");

  assert.doesNotMatch(html, /<del>/);
  assert.match(html, /5~7U/);
  assert.match(html, /100~200倍/);
});

test("keeps raw HTML from the model as visible text, never as markup", () => {
  const html = render("<img src=x onerror=alert(1)>\n\n<b>bold</b>");

  // 没有 rehype-raw：标签被转义成文本，浏览器不会执行它。
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<b>bold<\/b>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;b&gt;bold&lt;\/b&gt;/);
});

test("marks the streaming tail so the caret rides the last block", () => {
  assert.match(render("正在输出", { streaming: true }), /class="markdown-body mobile-streaming"/);
  assert.doesNotMatch(render("已结束"), /mobile-streaming/);
  assert.match(cssSource, /\.markdown-body\.mobile-streaming > :last-child::after \{[\s\S]*?animation: blink/);
  assert.match(cssSource, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.markdown-body\.mobile-streaming > :last-child::after,/);
});

test("stays out of the desktop markdown machinery", () => {
  // 只看 import 行：头上的注释本来就在说明为什么不用这些包。
  const importLines = source.split("\n").filter((line) => /^\s*import\b/.test(line)).join("\n");

  for (const heavy of [
    "react-syntax-highlighter",
    "rehype-katex",
    "rehype-raw",
    "rehype-sanitize",
    "katex",
    "mermaid",
    "remark-math",
    "lib/markdown",
    "./MarkdownBody",
    "./MermaidBlock",
  ]) {
    assert.doesNotMatch(importLines, new RegExp(heavy.replace(/[/.]/g, "\\$&")), `${heavy} must not load on /m`);
  }
  assert.match(importLines, /from "react-markdown"/);
  assert.match(importLines, /import remarkGfm from "remark-gfm"/);
  assert.match(source, /singleTilde: false/);
});
