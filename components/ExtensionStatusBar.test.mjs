import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const {
  ExtensionStatusBar,
  formatExtensionStatusLine,
  formatExtensionStatusParts,
  sanitizeExtensionStatusText,
} = await jiti.import("./ExtensionStatusBar.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function renderStatusBar(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ExtensionStatusBar, props),
    ),
  );
}

test("sorts status text by hidden key like the Pi CLI footer", () => {
  const statuses = [
    { key: "20-memory", text: "memory" },
    { key: "90-notify", text: "notify" },
    { key: "10-permissions", text: "permissions" },
    { key: "05-ponytail", text: "ponytail" },
  ];

  assert.equal(
    formatExtensionStatusLine(statuses),
    "ponytail permissions memory notify",
  );
});

test("sanitizes status text for a single-line display", () => {
  assert.equal(
    sanitizeExtensionStatusText("  first\tsecond \r\n third  "),
    "first second third",
  );
});

test("renders a single status line without identifier keys", () => {
  const html = renderStatusBar({
    statuses: [
      { key: "20-memory", text: "\x1b[32mmemory\x1b[0m" },
      { key: "05-ponytail", text: "ponytail" },
    ],
  });

  assert.match(html, /aria-label="ponytail memory"/);
  assert.match(html, /extension-status-shelf/);
  assert.match(html, /extension-status-line/);
  assert.match(html, /extension-status-text/);
  assert.match(html, />ponytail<\/span>/);
  assert.match(html, />memory</);
  assert.doesNotMatch(html, /05-ponytail|20-memory/);
});

test("replaces the MCP plug emoji with the MCP icon", () => {
  assert.deepEqual(
    formatExtensionStatusParts([{ key: "mcp", text: "🔌 MCP: 2 servers enabled" }]),
    [{ key: "mcp", text: "MCP: 2 servers enabled", icon: "mcp" }],
  );

  const html = renderStatusBar({
    statuses: [{ key: "mcp", text: "🔌 MCP: 2 servers enabled" }],
  });

  assert.match(html, /extension-status-icon/);
  assert.match(html, />MCP: 2 servers enabled</);
  assert.doesNotMatch(html, /🔌/u);
  assert.match(html, /aria-label="MCP: 2 servers enabled"/);
});

test("renders widgets and status text in one footer", () => {
  const html = renderStatusBar({
    statuses: [{ key: "status", text: "connected" }],
    widgets: [{
      key: "usage",
      lines: ["42%"],
      placement: "aboveEditor",
    }],
  });

  assert.match(html, /extension-status-shelf has-widgets has-status/);
  assert.match(html, /extension-widget-triggers/);
  assert.match(html, /usage/);
  assert.match(html, /connected/);
});

test("keeps task progress beside its widget and trailing statuses on the right", () => {
  const html = renderStatusBar({
    statuses: [
      { key: "mcp", text: "🔌 MCP: 2 servers enabled" },
      { key: "task-progress", text: "任务 1/3 · 正在执行：调整布局" },
    ],
    widgets: [{
      key: "任务进度",
      lines: ["已完成 1/3", "● 调整布局", "○ 运行检查"],
      placement: "aboveEditor",
    }],
  });

  const widgetIndex = html.indexOf("extension-widget-triggers");
  const taskIndex = html.indexOf("extension-task-status-line");
  const trailingIndex = html.indexOf("extension-status-line");

  assert.ok(widgetIndex >= 0);
  assert.ok(taskIndex > widgetIndex);
  assert.ok(trailingIndex > taskIndex);

  const triggers = html.match(/<div class="extension-widget-triggers"[^>]*>([\s\S]*?)<\/div>/)?.[1];
  const trigger = html.match(/<button[^>]*class="extension-widget-trigger is-expanded"[\s\S]*?<\/button>/)?.[0];
  assert.ok(triggers);
  assert.ok(trigger);
  assert.match(triggers, /class="extension-task-status-line"/);
  assert.doesNotMatch(trigger, /class="extension-task-status-line"/);
  assert.match(html, /class="extension-task-status-line"[^>]*aria-label="任务 1\/3 · 正在执行：调整布局"/);
  assert.match(html, /class="extension-status-line"[^>]*aria-label="MCP: 2 servers enabled"/);
  assert.doesNotMatch(html, /class="extension-task-status-fallback"/);
});

test("falls back to a standalone task status when its widget is unavailable", () => {
  const html = renderStatusBar({
    statuses: [{ key: "task-progress", text: "任务 0/2" }],
    widgets: [],
  });

  assert.match(html, /class="extension-task-status-fallback"/);
  assert.match(html, /class="extension-task-status-line"[^>]*aria-label="任务 0\/2"/);
});
