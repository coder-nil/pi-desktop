import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { AboutButton, AboutDialog } = await jiti.import("./AboutDialog.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");
const { PI_VERSION, CHANGELOG, changelogToMarkdown } = await jiti.import("../lib/changelog.ts");

const aboutSource = await readFile(new URL("./AboutDialog.tsx", import.meta.url), "utf8");
const sidebarSource = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const settingsSource = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const routeSource = await readFile(new URL("../app/api/changelog/route.ts", import.meta.url), "utf8");

const render = (element) => renderToStaticMarkup(
  React.createElement(I18nProvider, null, element),
);

test("renders the release notes straight from the bundled changelog", () => {
  const html = render(React.createElement(AboutDialog, { onClose() {} }));

  assert.match(html, /Pi Desktop/);
  // 变更记录是构建期的数据，渲染时不需要任何 fetch。
  assert.match(html, /0\.85\.1-alpha\.14/);
  assert.doesNotMatch(html, /fetch\(/);
});

test("shows the app version, the pi version and the platform", () => {
  const html = render(React.createElement(AboutDialog, { onClose() {} }));

  assert.match(aboutSource, /APPLICATION_VERSION/);
  assert.match(aboutSource, /PI_VERSION/);
  assert.match(aboutSource, /navigator\.platform/);
  assert.equal(typeof PI_VERSION, "string");
  assert.match(html, /Platform/);
});

test("the info icon opens the dialog instead of the dialog owning state", () => {
  // 对话框状态在 AppShell，侧边栏与设置里只发一个回调，两处共用同一个实例。
  const html = render(React.createElement(AboutButton, { onClick() {} }));
  assert.match(html, /aria-label="Version info"/);
  assert.match(html, /border-radius:50%/);
  assert.match(sidebarSource, /\{onAboutClick && \(\s*<AboutButton onClick=\{onAboutClick\} \/>/);
  assert.match(appShellSource, /onAboutClick=\{\(\) => setAboutOpen\(true\)\}/);
  assert.match(appShellSource, /\{aboutOpen && !settingsOpen && \(\s*<AboutDialog onClose=\{\(\) => setAboutOpen\(false\)\} \/>/);
});

test("the settings row shows both versions and hosts an embedded dialog", () => {
  // 常规页里的版本行直接显示版本号，ⓘ 才把变更记录叫出来。
  assert.match(settingsSource, /t\("settings\.aboutDescription", \{ version: APPLICATION_VERSION, piVersion: PI_VERSION \}\)/);
  assert.match(settingsSource, /\{renderAboutRow\(\)\}/);
  assert.match(settingsSource, /<AboutDialog embedded onClose=\{\(\) => setAboutOpen\(false\)\} \/>/);
});

test("escape closes only the innermost layer", () => {
  // 设置面板在关于对话框打开时不处理 Escape，否则一次按键会退两层。
  assert.match(aboutSource, /if \(embedded\) return;/);
  assert.match(settingsSource, /if \(aboutOpen\) return;/);
  assert.match(settingsSource, /\}, \[aboutOpen, isMobile, onClose, view\]\)/);
});

test("copy all exports the versions plus a markdown changelog", () => {
  assert.match(aboutSource, /copyText\(/);
  assert.match(aboutSource, /Pi Desktop v\$\{APPLICATION_VERSION\}/);
  assert.match(aboutSource, /changelogToMarkdown\(/);

  const markdown = changelogToMarkdown();
  // 断言"第一小节就是最新一版"，版本号取自打包进来的 changelog，
  // 这样每发一版不必再手改这里，也仍然能拦住首节错位。
  const newest = CHANGELOG[0];
  assert.ok(newest, "bundled changelog should not be empty");
  const escapedVersion = newest.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(markdown, new RegExp(`^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}`));
  assert.match(markdown, /### Added/);
  assert.match(markdown, /^- /m);
});

test("the route serves the bundled changelog and never hits the network", () => {
  assert.match(routeSource, /from "@\/lib\/changelog"/);
  assert.match(routeSource, /Cache-Control": "no-store"/);
  assert.doesNotMatch(routeSource, /fetch\(/);
});
