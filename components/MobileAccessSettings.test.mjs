import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { MobileAccessSettings } = await jiti.import("./MobileAccessSettings.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const source = await readFile(new URL("./MobileAccessSettings.tsx", import.meta.url), "utf8");
const routeSource = await readFile(
  new URL("../app/api/mobile/access/route.ts", import.meta.url),
  "utf8",
);

test("renders the settings section before the config arrives", () => {
  const html = renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(MobileAccessSettings)),
  );

  assert.match(html, /Loading/);
});

test("cannot be switched on before a long enough password is typed", () => {
  // 开关在缺少合格密码时禁用，并给出提示。
  assert.match(source, /disabled=\{saving \|\| \(!state\.enabled && !canEnable\)\}/);
  assert.match(source, /const canEnable = passwordDraft\.trim\(\)\.length >= state\.minPasswordLength/);
  assert.match(source, /settings\.mobilePasswordFirst/);
  assert.match(source, /settings\.mobilePasswordTooShort/);
});

test("writes the password and switch through the shared config endpoint", () => {
  assert.match(source, /fetch\("\/api\/mobile\/access"/);
  assert.match(source, /method: "PUT"/);
  assert.match(source, /body: JSON\.stringify\(\{ enabled, password: passwordDraft \}\)/);
  // 代理端口由桌面壳回写，界面轮询一次把二维码补上。
  assert.match(source, /void load\(\); \}, 1200\)/);
  assert.match(source, /<QRCodeSVG value=\{lanUrl\}/);
});

test("route rejects enabling without a password and never stores a weak one", () => {
  assert.match(routeSource, /code: "password-required"/);
  assert.match(routeSource, /validateDesktopAccessPassword/);
  assert.match(routeSource, /writeDesktopLanAccess\(\{ enabled: record\.enabled, password \}\)/);
  // 返回给界面的密码只用于让用户在手机上输入，接口本身受 Basic Auth 保护。
  assert.doesNotMatch(routeSource, /password: undefined/);
});
