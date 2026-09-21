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
  assert.match(source, /const canEnable = hasSavedPassword \|\| passwordDraft\.trim\(\)\.length >= state\.minPasswordLength/);
  assert.match(source, /settings\.mobilePasswordFirst/);
  assert.match(source, /settings\.mobilePasswordTooShort/);
});

test("writes the password and switch through the shared config endpoint", () => {
  assert.match(source, /fetch\("\/api\/mobile\/access"/);
  assert.match(source, /method: "PUT"/);
  assert.match(source, /const requestPassword = passwordDirty \? passwordDraft : ""/);
  assert.match(source, /body: JSON\.stringify\(\{ enabled, password: requestPassword \}\)/);
  // 代理端口由桌面壳回写，界面轮询一次把二维码补上。
  assert.match(source, /void load\(\); \}, 1200\)/);
});

test("shows a mask for a saved password and does not submit it unchanged", () => {
  assert.match(source, /const SAVED_PASSWORD_MASK = "••••••••"/);
  assert.match(source, /const showingSavedPasswordMask = hasSavedPassword && !passwordDirty/);
  assert.match(source, /value=\{showingSavedPasswordMask \? SAVED_PASSWORD_MASK : passwordDraft\}/);
  assert.match(source, /const requestPassword = passwordDirty \? passwordDraft : ""/);
});

test("shows one entry with a single QR code shared by LAN and public access", () => {
  // 局域网与公网通往的是同一个遥控页：公网隧道在跑就用公网地址，否则用局域网地址，
  // 界面上只有一份地址 + 一张二维码，避免两块内容重叠。
  assert.match(source, /const entryUrl = tunnelUrl \?\? lanUrl/);
  assert.match(source, /<QRCodeSVG value=\{entryUrl\}/);
  assert.equal(source.match(/<QRCodeSVG/g)?.length, 1);
  assert.equal(source.match(/copyText\(/g)?.length, 1);
});

test("route rejects enabling without a password and never stores a weak one", () => {
  assert.match(routeSource, /code: "password-required"/);
  assert.match(routeSource, /validateDesktopAccessPassword/);
  assert.match(routeSource, /writeDesktopLanAccess\(\{ enabled: record\.enabled, password, public: merged\.value \}\)/);
  // 返回给界面的密码只用于让用户在手机上输入，接口本身受 Basic Auth 保护。
  assert.doesNotMatch(routeSource, /password: undefined/);
});
