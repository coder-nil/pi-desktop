import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { MobilePromptCard } = await jiti.import("./MobilePromptCard.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const source = await readFile(new URL("./MobilePromptCard.tsx", import.meta.url), "utf8");

function render(request, props = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MobilePromptCard, { request, onRespond: () => {}, ...props }),
    ),
  );
}

const base = { id: "q1", title: "要合并吗？", method: "select", options: ["合并", "先放着"] };

test("renders a select prompt as tappable options", () => {
  const html = render(base);

  assert.match(html, /role="alertdialog"/);
  assert.match(html, /要合并吗？/);
  assert.match(html, />合并<\/button>/);
  assert.match(html, />先放着<\/button>/);
  // 单选不需要额外的提交按钮，点选项就是答案。
  assert.doesNotMatch(html, /Submit/);
  assert.match(html, />Cancel<\/button>/);
});

test("renders confirm, input and editor with the right controls", () => {
  const confirm = render({ id: "c1", title: "确定删除？", method: "confirm", message: "删了就没了" });
  assert.match(confirm, /删了就没了/);
  assert.match(confirm, />Confirm<\/button>/);

  const input = render({ id: "i1", title: "分支名？", method: "input", placeholder: "feat/x" });
  assert.match(input, /<input[^>]*placeholder="feat\/x"/);
  assert.match(input, />Submit<\/button>/);

  const editor = render({ id: "e1", title: "改文案", method: "editor", prefill: "原来的" });
  assert.match(editor, /<textarea/);
  assert.match(editor, /原来的/);
});

test("keeps sensitive input masked and the phone from zooming", () => {
  const html = render({ id: "i2", title: "口令", method: "input", sensitive: true });

  assert.match(html, /type="password"/);
  // 手机上输入控件 <16px 会触发 iOS 聚焦缩放（渲染出来是 CSS 形式）。
  assert.match(html, /font-size:16px/);
});

test("still offers a way out for custom extension interfaces", () => {
  const html = render({ id: "x1", title: "选择操作", method: "custom", lines: ["1. 部署", "2. 回滚"] });

  assert.match(html, /1\. 部署/);
  assert.match(html, /Answer it on the desktop/);
  assert.match(html, />Cancel<\/button>/);
  // 自定义界面没有可提交的内容。
  assert.doesNotMatch(html, />Submit<\/button>/);
});

test("disables every action while an answer is in flight", () => {
  const html = render(base, { busy: true });

  assert.equal(html.match(/<button[^>]*disabled/g)?.length, 3);
});

test("answers go back through the agent command endpoint", async () => {
  // 卡片本身只负责回调；实际 POST 在手机页里，这里守住契约与位置。
  const source = await readFile(new URL("./MobileRemoteView.tsx", import.meta.url), "utf8");

  assert.match(source, /type: "extension_ui_response", id: request\.id, \.\.\.response/);
  assert.match(source, /const answerPrompt = useCallback/);
  assert.match(source, /<MobilePromptCard request=\{pendingUiRequest\} onRespond=\{answerPrompt\} busy=\{answeringPrompt\} \/>/);
  assert.match(source, /const pendingUiRequest = eventPrompt \?\? snapshot\?\.pendingUiRequest \?\? null/);

  // 卡片在输入区上方（不在转录区里），不会被消息滚走。
  const card = source.indexOf("<MobilePromptCard");
  const composer = source.indexOf('padding: "10px 14px 12px"');
  assert.ok(card > 0 && composer > 0, "card and composer must both exist");
  assert.ok(card < composer, "the prompt card must sit above the composer");
});

test("stays a thin client component", () => {
  const importLines = source.split("\n").filter((line) => /^\s*import\b/.test(line)).join("\n");

  assert.match(source, /^"use client";/);
  for (const heavy of ["MarkdownBody", "react-markdown", "mermaid"]) {
    assert.doesNotMatch(importLines, new RegExp(heavy.replace(/[/.]/g, "\\$&")), `${heavy} must not load here`);
  }
});
