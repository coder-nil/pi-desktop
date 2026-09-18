import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { MobileRemoteView } = await jiti.import("./MobileRemoteView.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const viewSource = await readFile(new URL("./MobileRemoteView.tsx", import.meta.url), "utf8");
const pageSource = await readFile(new URL("../app/m/page.tsx", import.meta.url), "utf8");
const stateRouteSource = await readFile(
  new URL("../app/api/mobile/state/route.ts", import.meta.url),
  "utf8",
);

function render() {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(MobileRemoteView)),
  );
}

test("fits the remote view into one screen", () => {
  const html = render();

  assert.match(html, /Idle/);
  assert.match(html, /Stop/);
  assert.match(html, /Send/);
  assert.match(html, /New task/);
  assert.match(viewSource, /height: "var\(--app-viewport-height, 100dvh\)"/);
  assert.match(viewSource, /env\(safe-area-inset-top\)/);
  assert.match(viewSource, /flex: 1, minHeight: 0, overflowY: "auto"/);
});

test("never lets a server-picked session override the scanned one", () => {
  // URL 是唯一真相：参数读出前不发请求，且服务端挑中的会话只能在 URL 未指定时接管。
  assert.match(viewSource, /if \(!target\) return;/);
  assert.match(viewSource, /if \(!target\.session && data\.sessionId\)/);
  assert.match(viewSource, /if \(target\.session\) query\.set\("session", target\.session\)/);
});

test("reads the session snapshot instead of shipping demo data", () => {
  assert.match(viewSource, /fetch\(`\/api\/mobile\/state\?\$\{query\.toString\(\)\}`\)/);
  assert.doesNotMatch(viewSource, /DEMO_|Demo data/);
  // 快照接口在服务端就把消息压成纯文本。
  assert.match(stateRouteSource, /toMobileMessages\(context\.messages, context\.entryIds, limit\)/);
  assert.match(stateRouteSource, /listAllSessions\(\)/);
});

test("wires send, stop and new task to the existing agent endpoints", () => {
  assert.match(viewSource, /body: JSON\.stringify\(\{ type: "prompt", message: text \}\)/);
  assert.match(viewSource, /body: JSON\.stringify\(\{ type: "abort" \}\)/);
  assert.match(viewSource, /fetch\("\/api\/agent\/new"/);
  // 新任务只清空会话，下一次发送才真正建会话。
  assert.match(viewSource, /const startNewTask = useCallback/);
});

test("streams progress over SSE and resyncs when the page comes back", () => {
  assert.match(viewSource, /new EventSource\(`\/api\/agent\/\$\{encodeURIComponent\(sessionId\)\}\/events`\)/);
  assert.match(viewSource, /payload\.type === "message_update"/);
  assert.match(viewSource, /payload\.type === "prompt_done" \|\| payload\.type === "agent_settled"/);
  assert.match(viewSource, /document\.addEventListener\("visibilitychange", handleVisibility\)/);
  assert.match(viewSource, /void refresh\(\);/);
});

test("keeps the phone bundle free of the desktop renderers", () => {
  for (const heavy of ["MarkdownBody", "ChatMinimap", "FileExplorer", "TerminalPanel", "MermaidBlock"]) {
    assert.doesNotMatch(viewSource, new RegExp(`from "\\./${heavy}"`), `${heavy} must not load on /m`);
    assert.doesNotMatch(pageSource, new RegExp(`from "\\.\\./components/${heavy}"`), `${heavy} must not load on /m`);
  }
  // 手机上的输入框必须 ≥16px，否则 iOS 聚焦会整页放大。
  assert.match(viewSource, /fontSize: 16/);
});
