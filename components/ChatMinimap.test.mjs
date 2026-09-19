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
const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const globalsCss = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

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

test("keeps the minimap rail as a full-height column beside the chat", () => {
  assert.match(minimapSource, /onStateChange\?\.\(\{ visible, previewOpen \}\)/);
  assert.match(minimapSource, /onStateChange\?\.\(\{ visible: false, previewOpen: false \}\)/);
  assert.match(chatWindowSource, /onStateChange=\{handleMinimapStateChange\}/);

  // 整条右栏现在是 AppShell 里与 sidebar 平级的一列，且常驻（只动画宽度），
  // 因为 ChatWindow 要把节点层 portal 进来，折叠时槽位不能卸载
  assert.match(appShellSource, /data-chat-minimap-host=""/);
  assert.match(appShellSource, /minimapHost=\{minimapHost\}/);
  assert.match(appShellSource, /onMinimapStateChange=\{handleMinimapStateChange\}/);
  assert.match(appShellSource, /className=\{`chat-minimap-column\$\{minimapState\.visible \? " is-open" : ""\}`\}/);
  assert.match(
    appShellSource,
    /borderLeft: minimapState\.visible && !minimapState\.previewOpen/,
  );
  assert.match(globalsCss, /\.chat-minimap-column\.is-open \{[^}]*width: var\(--chat-minimap-width/);

  // 竖线走列自己的 background，才会被定位的节点层盖住
  assert.match(appShellSource, /backgroundImage: MINIMAP_RAIL_LINE/);

  // 空间由布局让出，不再用内边距/占位补偿，也不再在 ChatWindow 里画第二条
  assert.doesNotMatch(chatWindowSource, /data-chat-minimap-rail/);
  assert.doesNotMatch(chatWindowSource, /paddingRight: CHAT_MINIMAP_WIDTH/);
  assert.doesNotMatch(chatWindowSource, /marginRight: CHAT_MINIMAP_WIDTH/);
});

test("portals the interactive node layer into the rail column", () => {
  assert.match(chatWindowSource, /createPortal\(/);
  assert.match(chatWindowSource, /isMobile \|\| !minimapHost \? null : createPortal\(/);
  assert.match(chatWindowSource, /,\s*\n\s*minimapHost,\s*\n\s*\)/);

  // 节点层与预览浮层铺满整条右栏（含顶栏与输入区两段），而不是只占消息区那一段
  assert.match(minimapSource, /top: 0,\s*\n\s*bottom: 0,/);
  assert.match(minimapSource, /setMinimapHeight\(minimapEl\.clientHeight\)/);
  assert.doesNotMatch(minimapSource, /nodeLayerTop/);

  assert.match(
    minimapSource,
    /data-minimap-node-index=\{node\.index\}[\s\S]*?pointerEvents: "auto"[\s\S]*?zIndex: 2/,
  );
});

test("keeps the first minimap node clear of the rail's file-panel toggle", () => {
  const height = 900;
  const topInset = 36;
  const firstNodeTop = (layout) => layout.nodes[0].topRatio * height;

  // 第一个方格必须完全落在开关（0..topInset）下方
  for (const count of [1, 2, 6, 13, 40]) {
    const layout = layoutNodes(buildNodes(count), height, topInset);
    assert.ok(
      firstNodeTop(layout) >= topInset,
      `${count} turns: first node at ${firstNodeTop(layout)}px overlaps the ${topInset}px toggle row`,
    );
  }

  // 不传 inset 时保持原行为，旧调用点不受影响
  assert.equal(firstNodeTop(layoutNodes(buildNodes(6), height)), 12);

  // 极高密度下第一个节点也不能被推到可视区外
  const dense = layoutNodes(buildNodes(2000), height, topInset);
  assert.ok(firstNodeTop(dense) >= topInset && firstNodeTop(dense) < height);
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
