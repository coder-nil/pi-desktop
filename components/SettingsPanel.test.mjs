import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const source = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const shortcutCatalog = await readFile(new URL("../lib/keyboard-shortcuts.ts", import.meta.url), "utf8");

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { SettingsPanel } = await jiti.import("./SettingsPanel.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function renderSettingsPanel(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(SettingsPanel, {
        cwd: null,
        hasProject: false,
        projectTrusted: false,
        sessionId: null,
        onClose() {},
        onModelsSaved() {},
        onMcpConfigured() {},
        onSessionReloaded() {},
        soundEnabled: true,
        onSoundToggle() {},
        bannerEnabled: true,
        onBannerToggle() {},
        themePreference: "auto",
        locale: "zh-CN",
        supportedLocales: [{ id: "zh-CN", label: "简体中文" }],
        ...overrides,
      }),
    ),
  );
}

test("keeps all settings resources inside one navigable dialog", () => {
  assert.match(source, /type SettingsView = "menu" \| "general" \| "shortcuts" \| "models" \| "skills" \| "plugins" \| "mcp" \| "mobile" \| "mcp-editor"/);
  assert.match(source, /<ModelsConfig embedded onSaved=\{onModelsSaved\} \/>/);
  assert.match(source, /<SkillsConfig cwd=\{cwd\} embedded \/>/);
  assert.match(source, /<PluginsConfig cwd=\{cwd\} sessionId=\{sessionId\} embedded onReloaded=\{onSessionReloaded\} \/>/);
  assert.match(source, /<MobileAccessSettings \/>/);
  assert.doesNotMatch(source, /onOpenModels|onOpenSkills|onOpenPlugins/);
});

test("the settings overlay sits above every other layer", () => {
  // 设置是最高的弹层：高于关于对话框(1200)、SelectPicker 下拉(1201)、
  // Git 面板与各确认框(1100/1200)。
  const match = source.match(/position: "fixed", inset: 0, zIndex: (\d+)/);
  assert.ok(match, "settings overlay should be a fixed layer with an explicit zIndex");
  assert.ok(Number(match[1]) > 1201, `settings zIndex ${match[1]} must exceed every other layer`);
  // 设置里不再有子对话框，所以面板也不需要内部遮罩层。
  assert.doesNotMatch(source, /data-settings-subdialog|AboutDialog/);
});

test("retains visited settings sections and supports the mobile back flow", () => {
  assert.match(source, /const \[visitedSections, setVisitedSections\]/);
  assert.match(source, /updated\.add\(next\)/);
  assert.match(source, /isMobile && visibleView !== "menu"/);
  assert.match(source, /setView\(view === "mcp-editor" \? "mcp" : "menu"\)/);
});

test("groups interface preferences under General", () => {
  assert.match(source, /visitedSections\.has\("general"\)/);
  assert.match(source, /renderThemeRow\(\)/);
  assert.match(source, /renderLanguageRow\(\)/);
  assert.match(source, /t\("settings\.completionSound"\)/);
  assert.match(source, /t\("settings\.showBanner"\)/);
  // 「关于」固定在常规页的最后一行，只展示版本号，不可点、不弹窗。
  assert.ok(source.indexOf("{renderAboutRow()}") > source.indexOf('t("settings.showBanner")'));
  assert.match(source, /const renderAboutRow = \(\) => \(\s*<div/);
});

test("renders a read-only keyboard shortcut section from the shared catalog", () => {
  assert.match(source, /id: "shortcuts", label: t\("settings\.shortcuts"\)/);
  assert.match(source, /KEYBOARD_SHORTCUT_GROUPS\.map/);
  assert.match(source, /KEYBOARD_SHORTCUTS\.filter/);
  assert.match(source, /<kbd key=\{key\}/);
  assert.match(shortcutCatalog, /export const KEYBOARD_SHORTCUTS/);
  assert.match(shortcutCatalog, /id: "mention-lines"/);
});

// pi-web 常规页里在本项目成立的部分：聊天阅读区（思考默认展开、内容宽度、
// 内容字号）与 Windows 的 Shell 工具开关。主题沿用本项目的浅/深/跟随系统，
// 不引入 pi-web 的 mist/rose/pine 配色。
test("ports pi-web's chat reading surface settings", () => {
  assert.match(source, /const \{[\s\S]*?fontSize: chatContentFontSize,[\s\S]*?\} = useChatAppearance\(\);/);
  assert.match(source, /t\("settings\.groupChat"\)/);
  assert.match(source, /renderThinkingRow\(\)/);
  assert.match(source, /renderChatWidthRow\(\)/);
  assert.match(source, /renderChatFontSizeRow\(\)/);
  // 开关先落盘再广播，已挂载的思考块才能原地开合。
  assert.match(source, /setThinkingExpandedByDefault\(enabled\)/);
  // 滑块带重置，默认值直接取自 lib/chat-appearance.ts。
  assert.match(source, /CHAT_CONTENT_WIDTH_DEFAULT/);
  assert.match(source, /CHAT_CONTENT_FONT_SIZE_DEFAULT/);
  assert.match(source, /aria-label=\{range\.resetLabel\}/);
});

test("wires the Windows PowerShell switch to the tools settings route", () => {
  assert.match(source, /t\("settings\.shellTool"\)/);
  assert.match(source, /renderShellToolRow\(\)/);
  assert.match(source, /fetch\("\/api\/tools\/settings"/);
  assert.match(source, /method: "PUT"/);
  assert.match(source, /checked=\{shellSettings\?\.powerShellEnabled === true\}/);
  // 工具集在会话创建时固定，保存后必须重载会话，否则新 shell 工具不生效。
  assert.match(source, /await sendAgentCommand\(sessionId, \{ type: "reload" \}\)/);
  assert.match(source, /onSessionReloaded\(\)/);
  // 非 Windows 不渲染这一节；读取失败时反而要渲染，否则用户看不到原因。
  assert.match(source, /shellSettings\?\.isWindows === true \|\| shellError !== null/);
});

// 常规页的聊天阅读区在服务端渲染时必须是默认值：偏好存在浏览器里，服务端快照
// 与 lib/chat-appearance.ts 的常量必须一致，否则 hydration 后数值会跳。
test("renders the ported General rows with the chat reading surface", () => {
  const html = renderSettingsPanel();

  assert.match(html, /id="settings-chat-content-width"/);
  assert.match(html, /id="settings-chat-content-font-size"/);
  assert.equal((html.match(/type="range"/g) ?? []).length, 2);
  assert.match(html, />820px</);
  assert.match(html, />14px</);
  // 非 Windows（或尚未读到设置）时不渲染 Shell 工具分节。
  assert.doesNotMatch(html, /usePowerShell|使用 PowerShell|Use PowerShell/);
  // 默认状态的重置按钮是禁用的：当前值就是默认值。
  assert.ok((html.match(/<button[^>]*disabled=""[^>]*>/g) ?? []).length >= 2, "both reset buttons should start disabled");
});
