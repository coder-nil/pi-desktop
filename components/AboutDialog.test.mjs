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
  // 对话框状态在 AppShell，侧边栏只发一个回调。
  const html = render(React.createElement(AboutButton, { onClick() {} }));
  assert.match(html, /aria-label="Version info"/);
  // 图标是干净的 lucide ⓘ：没有描边圆框。
  assert.match(aboutSource, /import \{ Info \} from "lucide-react"/);
  assert.doesNotMatch(html, /border-radius:50%/);
  // 侧边栏的 ⓘ 由标题组件自己渲染，且只在标题翻成版本号时出现。
  assert.match(sidebarSource, /<PiWebTitle onAboutClick=\{onAboutClick\} \/>/);
  assert.match(sidebarSource, /\{showVersion && onAboutClick && <AboutButton onClick=\{onAboutClick\} \/>\}/);
  assert.match(appShellSource, /onAboutClick=\{\(\) => setAboutOpen\(true\)\}/);
  assert.match(appShellSource, /\{aboutOpen && !settingsOpen && \(\s*<AboutDialog onClose=\{\(\) => setAboutOpen\(false\)\} \/>/);
});

test("the settings row only shows the versions, it opens nothing", () => {
  // 常规页的版本行只展示版本号：没有 ⓘ、不可点、无右侧控件，也不在设置里叠关于对话框。
  assert.match(settingsSource, /t\("settings\.aboutDescription", \{ version: APPLICATION_VERSION, piVersion: PI_VERSION \}\)/);
  assert.match(settingsSource, /\{renderAboutRow\(\)\}/);
  assert.doesNotMatch(settingsSource, /AboutButton|AboutDialog|aboutOpen/);
  assert.match(settingsSource, /const renderAboutRow = \(\) => \(\s*<SettingsRow[\s\S]*?monospaceDescription\s*\/>\s*\);/);
  const aboutRow = settingsSource.match(/const renderAboutRow = \(\) => \([\s\S]*?\n  \);/)?.[0] ?? "";
  assert.ok(aboutRow, "renderAboutRow should be a self-contained row");
  assert.doesNotMatch(aboutRow, /button|SettingsSwitch|SettingsSelect/);
});

test("escape only has one dialog to close", () => {
  // 关于只有弹窗一种形态，Escape 由它自己处理并阻止冒泡；
  // 设置面板则是“没有子对话框”的简单分支。
  assert.match(aboutSource, /event\.stopPropagation\(\)/);
  assert.match(aboutSource, /document\.addEventListener\("keydown", handleKeyDown, true\)/);
  assert.doesNotMatch(aboutSource, /embedded/);
  assert.match(settingsSource, /\}, \[isMobile, onClose, view\]\);/);
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
