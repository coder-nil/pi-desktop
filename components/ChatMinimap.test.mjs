import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith(".module.css")) return nextLoad(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: "export default new Proxy({}, { get: (_, key) => String(key) });",
    };
  },
});

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { AssistantOutline } = await jiti.import("./ChatMinimap.tsx");
const minimapSource = await readFile(new URL("./ChatMinimap.tsx", import.meta.url), "utf8");
const chatWindowSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("renders math in headings without disabling heading navigation", () => {
  const html = renderToStaticMarkup(
    React.createElement(AssistantOutline, {
      markdown: String.raw`# Inline $f_{k,t+1}$

## Parentheses \(x^2 + y^2\)`,
      onHeadingClick() {},
    }),
  );

  assert.match(html, /class="katex"/);
  assert.match(html, /data-preview-heading-index="0"/);
  assert.match(html, /data-preview-heading-index="1"/);
  assert.doesNotMatch(html, /disabled=""/);
});

test("keeps the input-side rail in sync with minimap visibility and preview state", () => {
  assert.match(minimapSource, /onStateChange\?\.\(\{ visible, previewOpen \}\)/);
  assert.match(minimapSource, /onStateChange\?\.\(\{ visible: false, previewOpen: false \}\)/);
  assert.match(chatWindowSource, /onStateChange=\{handleMinimapStateChange\}/);
  assert.match(
    chatWindowSource,
    /!isMobile && minimapState\.visible && \(/,
  );
  assert.match(
    chatWindowSource,
    /borderLeft: minimapState\.previewOpen \? "none" : "1px solid var\(--border\)"/,
  );
});
