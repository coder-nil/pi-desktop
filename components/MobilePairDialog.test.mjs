import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { MobilePairDialog } = await jiti.import("./MobilePairDialog.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const dialogSource = await readFile(new URL("./MobilePairDialog.tsx", import.meta.url), "utf8");
const chatInputSource = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const chatWindowSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const routeSource = await readFile(
  new URL("../app/api/mobile/pair/route.ts", import.meta.url),
  "utf8",
);

test("renders the dialog shell before the pairing info arrives", () => {
  const html = renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(MobilePairDialog, {
      sessionId: "abc-123",
      cwd: "/tmp/pi-desktop",
      onClose() {},
    })),
  );

  assert.match(html, /Phone access/);
  assert.match(html, /Preparing/);
});

test("only renders a QR code when a LAN address is available", () => {
  assert.match(dialogSource, /state\.phase === "ready" && state\.info\.url && \(/);
  assert.match(dialogSource, /<QRCodeSVG value=\{state\.info\.url\}/);
  // 深色主题下二维码必须有白底才能扫。
  assert.match(dialogSource, /background: "#fff"/);
});

test("explains how to enable LAN access instead of showing a dead code", () => {
  assert.match(dialogSource, /state\.phase === "ready" && !state\.info\.url && \(/);
  // 桌面壳里未开启 → 引导去设置；命令行直启 → 给出 dev:lan 命令。
  assert.match(dialogSource, /mobile\.pairLanDisabled/);
  assert.match(dialogSource, /state\.info\.reason === "loopback-only" && \(/);
  assert.match(dialogSource, /npm run dev:lan/);
  assert.match(dialogSource, /mobile\.pairStarting/);
  assert.match(dialogSource, /mobile\.pairNoAddress/);
});

test("never leaks credentials through the pairing payload", () => {
  assert.match(routeSource, /passwordRequired: access\.password !== null \|\| Boolean\(process\.env\.PI_WEB_PASSWORD\)/);
  // pair 只回报“是否需要密码”，不返回密码本身。
  assert.doesNotMatch(routeSource, /password:\s/);
  assert.doesNotMatch(routeSource, /PI_WEB_PASSWORD\s*\}/);
  // 弹窗里没有任何密钥输入控件。
  assert.doesNotMatch(dialogSource, /type="password"/);
  assert.doesNotMatch(dialogSource, /process\.env/);
});

test("warns when a brand-new session has no id to pin yet", () => {
  assert.match(dialogSource, /\{!sessionId && \(/);
  assert.match(dialogSource, /mobile\.pairNoSession/);
});

test("adds a scan button next to the attachment control", () => {
  assert.match(chatInputSource, /sessionId\?: string/);
  assert.match(chatInputSource, /\{!isMobile && \(\s*<button\s*onClick=\{\(\) => setPairDialogOpen\(true\)\}/);
  assert.match(chatInputSource, /<MobilePairDialog/);
  assert.match(chatWindowSource, /sessionId=\{session\?\.id \?\? sessionIdRef\.current \?\? undefined\}/);
});
