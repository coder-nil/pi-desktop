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
const { AssistantOutline, layoutNodes } = await jiti.import("./ChatMinimap.tsx");
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
    /data-minimap-status-clearance=""[\s\S]*?marginRight: CHAT_MINIMAP_WIDTH/,
  );
  assert.match(
    chatWindowSource,
    /borderLeft: minimapState\.previewOpen \? "none" : "1px solid var\(--border\)"/,
  );
  assert.match(
    chatWindowSource,
    /data-minimap-input-rail-line=""[\s\S]*?left: "50%"[\s\S]*?background: "var\(--border\)"/,
  );
});

test("keeps minimap node hit areas interactive above the input rail", () => {
  assert.match(
    chatWindowSource,
    /className="relative flex min-w-0 flex-1 overflow-hidden"/,
  );
  assert.match(
    minimapSource,
    /data-minimap-node-index=\{node\.index\}[\s\S]*?pointerEvents: "auto"[\s\S]*?zIndex: 2/,
  );
});

function buildNodes(count) {
  return Array.from({ length: count }, (_, index) => ({
    index,
    topRatio: 0,
    targetTurn: { userMessage: { role: "user", content: "" }, assistantPreviews: [], scrollTop: 0 },
  }));
}

test("shrinks minimap nodes to fit as turns pile up", () => {
  const height = 600;

  const sparse = layoutNodes(buildNodes(6), height);
  assert.equal(sparse.fillsHeight, false);
  assert.equal(sparse.gap, 50);
  assert.equal(sparse.nodeSize, 8);
  assert.equal(sparse.nodeBorder, 1.5);

  // 铺满高度但还没压到默认方块放不下时，视觉规格保持不变
  const filled = layoutNodes(buildNodes(13), height);
  assert.equal(filled.fillsHeight, true);
  assert.equal(filled.nodeSize, 8);
  assert.equal(filled.nodeBorder, 1.5);

  let previousSize = Infinity;
  for (const count of [20, 40, 60, 120, 300]) {
    const layout = layoutNodes(buildNodes(count), height);
    const extent = layout.nodeSize + layout.nodeBorder * 2;
    assert.ok(
      extent <= Math.max(layout.gap, 2) + 1e-9,
      `${count} turns overlap: node ${extent}px vs gap ${layout.gap}px`,
    );
    assert.ok(layout.nodeSize >= 2 && layout.nodeSize <= 8);
    assert.ok(
      layout.nodeSize <= previousSize,
      `${count} turns must not grow the node back to ${layout.nodeSize}`,
    );
    previousSize = layout.nodeSize;
  }

  const extreme = layoutNodes(buildNodes(2000), height);
  assert.equal(extreme.nodeSize, 2);
  assert.equal(extreme.nodeBorder, 0);
});
