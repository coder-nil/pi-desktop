import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ChatInput, ModelErrorBanner, ModelScopeWarningBanner, buildComposerMessage, buildSkillMenuGroups, canRestoreUserMessage, filterModelOptions, getQueueShortcutMode, getSlashCommandTagKind, getUpwardMenuMaxHeight, getUserMessageText, getUserMessageDraftImages, parseSelectedAtMention, parseSelectedAtMentions, stripMacOSArrowFunctionKeys } = await jiti.import("./ChatInput.tsx");
const { clearDraft, getDraft, mergeRestoredSubmissionDraft, mergeRestoredSubmissionText, rekeyDraft, setDraft } = await jiti.import("../lib/draft-store.ts");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");
const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const globalsCss = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const enMessages = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const zhMessages = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");

/** 模型/队列文案都要走 I18nProvider。 */
const renderWithI18n = (element) => renderToStaticMarkup(
  React.createElement(I18nProvider, null, element),
);

test("renders the upstream model error", () => {
  const html = renderWithI18n(
    React.createElement(ModelErrorBanner, {
      error: "Invalid models.json schema:\nproviders.custom.models.0.id must not be empty",
    }),
  );

  assert.match(html, /role="alert"/);
  assert.match(html, /Model error/);
  assert.match(html, /providers\.custom\.models\.0\.id must not be empty/);
});

test("does not render an empty model error", () => {
  assert.equal(renderWithI18n(React.createElement(ModelErrorBanner, { error: null })), "");
});

test("classifies slash command tags by resource kind", () => {
  assert.equal(getSlashCommandTagKind({ name: "skill:review", description: "", source: "skill" }), "skill");
  assert.equal(getSlashCommandTagKind({ name: "inspect", description: "", source: "extension", sourceInfo: { path: "/tmp/mcp-server.ts", source: "mcp", scope: "user", origin: "top-level" } }), "mcp");
  assert.equal(getSlashCommandTagKind({ name: "deploy", description: "", source: "extension", sourceInfo: { path: "/tmp/pi-plugin/index.ts", source: "pi-plugin", scope: "user", origin: "package" } }), "plugin");
  assert.equal(getSlashCommandTagKind({ name: "reload", description: "", source: "builtin" }), "command");
});

test("groups searchable skills by source and keeps dormant skills last", () => {
  const makeSkill = (name, description, source, scope, disableModelInvocation = false) => ({
    name,
    description,
    filePath: `/tmp/${name}/SKILL.md`,
    baseDir: `/tmp/${name}`,
    disableModelInvocation,
    sourceInfo: { source, scope },
  });
  const groups = buildSkillMenuGroups([
    makeSkill("project-review", "Review project code", "project", "project"),
    makeSkill("imagegen", "Generate images", "official", "user"),
    makeSkill("dormant-docs", "Write documentation", "user", "user", true),
    makeSkill("active-docs", "Search documentation", "user", "user"),
  ], "");

  assert.deepEqual(groups.map((group) => group.id), ["official", "project", "global"]);
  assert.deepEqual(groups.find((group) => group.id === "global").skills.map((skill) => skill.name), [
    "active-docs",
    "dormant-docs",
  ]);
  assert.deepEqual(
    buildSkillMenuGroups(groups.flatMap((group) => group.skills), "generate")
      .flatMap((group) => group.skills.map((skill) => skill.name)),
    ["imagegen"],
  );
});

test("turns completed @ references into removable composer tags", () => {
  assert.deepEqual(parseSelectedAtMention("@components/ChatInput.tsx "), { text: "@components/ChatInput.tsx" });
  assert.deepEqual(parseSelectedAtMention('@"docs/my file.md" '), { text: '@"docs/my file.md"' });
  assert.deepEqual(parseSelectedAtMention('@"src/my file.ts":10-20 '), { text: '@"src/my file.ts":10-20' });
  assert.deepEqual(parseSelectedAtMentions("@src/a.ts @src/b.ts "), [
    { text: "@src/a.ts" },
    { text: "@src/b.ts" },
  ]);
  assert.equal(parseSelectedAtMention("review @components/ChatInput.tsx"), null);
  assert.equal(parseSelectedAtMention("@"), null);
});

test("converts both file and directory autocomplete selections into tags", () => {
  assert.match(source, /const insert = buildAtInsertText\(entry\.path, entry\.isDir, atQuery\.quoted\);\s*const mention = parseSelectedAtMention\(insert\.text\);/);
  assert.doesNotMatch(source, /if \(!entry\.isDir\)/);
  assert.match(source, /setAtQuery\(null\);/);
});

test("persists selected @ tags in composer drafts", () => {
  const key = "mention-draft";
  clearDraft(key);
  setDraft(key, {
    value: "review these",
    images: [],
    selectedMentions: [{ text: "@src/a.ts" }, { text: '@"src/my file.ts":2' }],
  });
  assert.deepEqual(getDraft(key)?.selectedMentions, [
    { text: "@src/a.ts" },
    { text: '@"src/my file.ts":2' },
  ]);
  clearDraft(key);
});

test("removes the nearest @ tag before the command tag on empty Backspace", () => {
  assert.match(
    source,
    /if \(selectedAtMentions\.length > 0\) \{\s*removeSelectedAtMention\(selectedAtMentions\.length - 1\);\s*\} else \{\s*removeSelectedSlashCommand\(\);/,
  );
});

test("reassembles mention tags before the remaining composer text", () => {
  assert.equal(
    buildComposerMessage("please review", null, [{ text: "@src/app.ts" }, { text: '@"docs/my file.md"' }]),
    '@src/app.ts @"docs/my file.md" please review',
  );
  assert.equal(
    buildComposerMessage("focus on errors", { name: "skill:review", kind: "skill" }, [{ text: "@src/app.ts" }]),
    "/skill:review @src/app.ts focus on errors",
  );
});

test("renders enabledModels scope warnings", () => {
  const html = renderWithI18n(
    React.createElement(ModelScopeWarningBanner, {
      warnings: ['No models match pattern "ghost-gateway/*"'],
    }),
  );

  assert.match(html, /Model scope warning/);
  assert.match(html, /ghost-gateway/);
  assert.equal(renderWithI18n(React.createElement(ModelScopeWarningBanner, { warnings: [] })), "");
});

test("localizes the queue badges and the model selector copy", () => {
  // 队列徽标以前直接渲染内部 kind 字面量（steer / follow-up）。
  assert.match(source, /\{kind === "steer" \? t\("chat\.steer"\) : t\("chat\.followUp"\)\}/);

  // 模型按钮与提示条不再有硬编码英文。
  for (const [, snippet] of source.matchAll(/[^\n]*(?:Change model|Switching model|Select model|No models|No available models|Model error|Model scope warning)[^\n]*/g)) {
    assert.fail(`hardcoded copy left in ChatInput.tsx: ${snippet.trim()}`);
  }
  assert.match(source, /t\("chat\.changeModel"\)/);
  assert.match(source, /t\("chat\.modelScopeWarnings"\)/);

  for (const key of [
    "chat.changeModel",
    "chat.switchingModel",
    "chat.selectModel",
    "chat.noModels",
    "chat.noAvailableModels",
    "chat.modelError",
    "chat.modelScopeWarning",
    "chat.modelScopeWarnings",
  ]) {
    assert.ok(enMessages.includes(`"${key}": `), `en is missing ${key}`);
    assert.ok(zhMessages.includes(`"${key}": `), `zh-CN is missing ${key}`);
  }
});

test("keeps the model selector visible when a model error leaves no options", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onModelChange() {},
        isStreaming: false,
        modelError: "Invalid models.json schema",
        modelList: [],
        modelNames: {},
      }),
    ),
  );

  assert.match(html, />No models</);
  assert.match(html, /title="No available models"/);
});

test("renders the read-only tool preset as the active selection", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onToolPresetChange() {},
        isStreaming: false,
        toolPreset: "read-only",
      }),
    ),
  );

  assert.match(html, /title="Change tool preset: read-only"/);
  assert.match(html, />read-only<\/span>/);
});

test("shows and locks the optimistic model while a switch is pending", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onModelChange() {},
        isStreaming: false,
        model: { provider: "deepseek", modelId: "deepseek-v4-flash" },
        modelList: [{ provider: "deepseek", id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
        modelSwitching: true,
      }),
    ),
  );

  assert.match(html, /title="Switching model"/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /disabled=""/);
  assert.match(html, />DeepSeek V4 Flash</);
  assert.match(html, /animation:spin 0\.8s linear infinite/);
});

test("filters model options by name and id", () => {
  const options = [
    { provider: "ollama", modelId: "qwen3:latest", name: "Qwen 3" },
    { provider: "anthropic", modelId: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { provider: "openai", modelId: "gpt-5.4", name: "GPT-5.4" },
  ];

  assert.deepEqual(filterModelOptions(options, "QWEN"), [options[0]]);
  assert.deepEqual(filterModelOptions(options, "claude-sonnet"), [options[1]]);
  assert.equal(filterModelOptions(options, "OpenAI").length, 0);
  assert.equal(filterModelOptions(options, "anthropic/claude").length, 0);
  assert.equal(filterModelOptions(options, "missing").length, 0);
  assert.equal(filterModelOptions(options, "  "), options);
});

test("caps an upward menu to the visible space above its anchor", () => {
  assert.equal(getUpwardMenuMaxHeight(343, 36), 299);
  assert.equal(getUpwardMenuMaxHeight(40, 36), 0);
});

test("maps queue shortcuts by physical key while requiring Alt only", () => {
  const event = (overrides) => ({
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    code: "",
    key: "",
    ...overrides,
  });

  assert.equal(getQueueShortcutMode(event({ code: "KeyF", key: "ƒ" })), "steer");
  assert.equal(getQueueShortcutMode(event({ code: "KeyQ", key: "œ" })), "followup");
  assert.equal(getQueueShortcutMode(event({ code: "KeyF", key: "f", ctrlKey: true })), null);
  assert.equal(getQueueShortcutMode(event({ code: "KeyQ", key: "q", altKey: false })), null);
});

test("strips macOS arrow function-key characters submitted as text", () => {
  assert.equal(stripMacOSArrowFunctionKeys(`a\uF700\uF701\uF702\uF703b`), "ab");
  assert.equal(stripMacOSArrowFunctionKeys("中文 abc \uF704"), "中文 abc \uF704");
});

test("prevents WKWebView from handling arrow keys past text boundaries", () => {
  assert.match(source, /e\.key === "ArrowLeft" \|\|[\s\S]*?e\.code === "ArrowLeft" \|\|[\s\S]*?e\.key === "\\uF702" \|\|[\s\S]*?nativeEvent\.keyCode === 37/);
  assert.match(source, /e\.key === "ArrowRight" \|\|[\s\S]*?e\.code === "ArrowRight" \|\|[\s\S]*?e\.key === "\\uF703" \|\|[\s\S]*?nativeEvent\.keyCode === 39/);
  assert.match(source, /const atStart = selectionIsCollapsed && ta\.selectionStart === 0/);
  assert.match(source, /const atEnd = selectionIsCollapsed && ta\.selectionEnd === ta\.value\.length/);
  assert.match(source, /if \(\(isLeftArrow && atStart\) \|\| \(isRightArrow && atEnd\)\) \{\s*e\.preventDefault\(\)/);
});

test("sanitizes the live textarea when InputMethodKit skips onChange", () => {
  assert.match(source, /const handleInput = useCallback\(\(e: React\.FormEvent<HTMLTextAreaElement>\)/);
  assert.match(source, /ta\.value = nextValue;[\s\S]*?valueRef\.current = nextValue;[\s\S]*?setValue\(nextValue\)/);
});

test("vertically centers the textarea content in its single-line composer", () => {
  assert.match(source, /maskImage: "url\('\/icons\/pi-input-mark\.png'\)"[\s\S]*?marginTop: 2/);
  assert.match(source, /<textarea[\s\S]*?alignSelf: "center"/);
  assert.match(source, /<textarea[\s\S]*?margin: 0,[\s\S]*?padding: 0/);
  assert.match(source, /<textarea[\s\S]*?lineHeight: "24px"[\s\S]*?minHeight: 24/);
});

test("scrolls the composer field so the scrollbar and send controls sit on the outer edge", () => {
  const idleHtml = renderWithI18n(
    React.createElement(ChatInput, { onSend() {}, onAbort() {}, isStreaming: false }),
  );
  assert.match(idleHtml, /class="chat-composer-field"/);
  assert.match(idleHtml, /class="chat-composer-mark"/);
  assert.match(idleHtml, /class="chat-composer-send"/);

  const streamingHtml = renderWithI18n(
    React.createElement(ChatInput, { onSend() {}, onAbort() {}, isStreaming: true }),
  );
  assert.match(streamingHtml, /class="chat-composer-queue-actions"/);

  // The field is the scroll container, so the scrollbar is drawn next to the
  // border instead of along an inner textarea edge.
  assert.match(globalsCss, /\.chat-composer-field \{[\s\S]*?max-height: 222px;[\s\S]*?overflow-y: auto;/);
  // Mark and send controls stay pinned while the text scrolls behind them.
  assert.match(globalsCss, /\.chat-composer-mark-button \{\s*position: sticky;\s*top: 0;/);
  assert.match(globalsCss, /\.chat-composer-send \{\s*position: sticky;\s*bottom: var\(--composer-padding-y\);\s*\}/);
  assert.match(globalsCss, /\.chat-composer-queue-actions \{\s*position: sticky;\s*bottom: var\(--composer-padding-y\);/);

  // The textarea grows with its content; scrolling it would expose an inner
  // boundary again.
  assert.match(source, /<textarea[\s\S]*?minHeight: 24,\s*overflow: "hidden",/);
  assert.doesNotMatch(source, /Math\.min\([a-z]+\.scrollHeight, 200\)/);
  assert.match(source, /function resizeComposerTextarea\(textarea: HTMLTextAreaElement \| null\): void \{[\s\S]*?textarea\.style\.height = `\$\{measured\}px`;/);

  // The queue menu is a popup: inside the scroll container the field would
  // clip it, so it is rendered before the field in document order.
  const menuIndex = source.indexOf('className="chat-composer-queue-menu"');
  assert.ok(menuIndex > -1 && menuIndex < source.indexOf('className="chat-composer-field"'));
});

test("the composer π mark toggles plain conversation mode", () => {
  const chatHtml = renderWithI18n(
    React.createElement(ChatInput, {
      onSend() {}, onAbort() {}, isStreaming: false,
      chatMode: "chat", onChatModeChange() {},
    }),
  );
  const workHtml = renderWithI18n(
    React.createElement(ChatInput, {
      onSend() {}, onAbort() {}, isStreaming: false,
      chatMode: "work", onChatModeChange() {},
    }),
  );

  // The mark became a button; chat mode tints it and points back at work mode.
  assert.match(source, /className="chat-composer-mark-button"/);
  assert.match(source, /backgroundColor: chatModeActive \? "var\(--accent\)" : "var\(--text\)"/);
  assert.match(source, /onChatModeChange\?\.\(chatModeActive \? "work" : "chat"\)/);
  assert.match(chatHtml, /aria-pressed="true"/);
  assert.match(chatHtml, /aria-label="Switch back to work mode"/);
  assert.match(workHtml, /aria-pressed="false"/);
  assert.match(workHtml, /aria-label="Switch to plain conversation mode \(no tools\)"/);
  assert.match(chatHtml, /placeholder="Just chat…"/);

  // No tools means neither the tool preset nor the ! shell mode can apply.
  assert.match(source, /const toolPresetDisabled = isStreaming \|\| chatModeActive;/);
  assert.match(source, /const bashMode = !chatModeActive &&/);
});

test("arrow keys select a queue mode, pause auto-send, and Enter confirms it", () => {
  assert.match(source, /const selectQueueMode = useCallback\(\(mode: QueueSendMode\) => \{\s*setQueueCountdownPaused\(true\);\s*setQueueActiveMode\(mode\);/);
  assert.match(source, /selectQueueMode\(queueActiveMode === "followup" \? "steer" : "followup"\)/);
  assert.match(source, /if \(event\.key === "Enter"\) \{[\s\S]*?sendQueued\(queueActiveMode\)/);
  assert.match(source, /if \(!queueMenuVisible \|\| !onFollowUp \|\| queueCountdownPaused\) return/);
  assert.match(source, /role="menuitemradio"[\s\S]*?aria-checked=\{queueActiveMode === "steer"\}/);
  assert.match(source, /role="menuitemradio"[\s\S]*?aria-checked=\{queueActiveMode === "followup"\}/);
  assert.match(source, /<kbd className="chat-composer-queue-shortcut">Alt\+F<\/kbd>/);
  assert.match(source, /<kbd className="chat-composer-queue-shortcut">Alt\+Q<\/kbd>/);
});

test("caps the skill menu to the measured visible space above its trigger", () => {
  assert.match(source, /const \[skillMenuMaxHeight, setSkillMenuMaxHeight\] = useState<number \| null>\(null\);/);
  assert.match(source, /if \(!skillMenuOpen\) \{\s*setSkillMenuMaxHeight\(null\);/);
  assert.match(source, /maxHeight: skillMenuMaxHeight === null\s*\? "min\(58vh, 460px\)"\s*:\s*`min\(58vh, 460px, \$\{skillMenuMaxHeight\}px\)`/);
});

test("restores text and base64 images when editing a user message", () => {
  const message = {
    role: "user",
    content: [
      { type: "text", text: "Review this image @src/example.ts " },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
    ],
  };

  assert.equal(getUserMessageText(message), "Review this image @src/example.ts ");
  assert.deepEqual(getUserMessageDraftImages(message), [
    { data: "AQID", mimeType: "image/png" },
  ]);
});

test("restores legacy flat image entries when editing a user message", () => {
  const message = {
    role: "user",
    content: [
      { type: "image", data: "AQID", mimeType: "image/jpeg" },
    ],
  };

  assert.deepEqual(getUserMessageDraftImages(message), [
    { data: "AQID", mimeType: "image/jpeg" },
  ]);
});

test("does not restore a historical message over a pending image attachment", () => {
  assert.equal(canRestoreUserMessage("", 0, 0), true);
  assert.equal(canRestoreUserMessage("", 1, 0), false);
  assert.equal(canRestoreUserMessage("", 0, 1), false);
  assert.equal(canRestoreUserMessage("", 0, 0, 1), false);
  assert.equal(canRestoreUserMessage("draft", 0, 0), false);
});

test("restores a cleared submission using the queued React state", () => {
  let value = "failed submission";
  const updates = [
    () => "",
    (current) => mergeRestoredSubmissionText("failed submission", current),
  ];

  for (const update of updates) value = update(value);

  assert.equal(value, "failed submission");
  assert.equal(
    mergeRestoredSubmissionText("failed submission", "new draft"),
    "failed submission\n\nnew draft",
  );
  assert.equal(
    mergeRestoredSubmissionText("failed submission", "failed submission"),
    "failed submission\n\nfailed submission",
  );
});

test("keeps a failed first submission recoverable across a composer remount", () => {
  const image = { data: "AQID", mimeType: "image/png" };
  const restored = mergeRestoredSubmissionDraft(
    "failed submission",
    [image],
    "",
    [],
  );

  assert.deepEqual(restored, {
    value: "failed submission",
    images: [image],
  });
  assert.deepEqual(
    mergeRestoredSubmissionDraft("failed submission", [image], "new draft", []),
    {
      value: "failed submission\n\nnew draft",
      images: [image],
    },
  );
});

test("preserves duplicate image attachments when restoring a submission", () => {
  const image = { data: "AQID", mimeType: "image/png" };
  const restored = mergeRestoredSubmissionDraft("", [image, image], "", [image]);

  assert.deepEqual(restored.images, [image, image, image]);
});

test("moves a provisional new-session draft to the real session key", () => {
  const provisionalKey = "new:/tmp/rekey-test";
  const sessionKey = "session-rekey-test";
  clearDraft(provisionalKey);
  clearDraft(sessionKey);
  setDraft(provisionalKey, { value: "queued while preflight ran", images: [] });

  assert.deepEqual(rekeyDraft(provisionalKey, sessionKey), {
    value: "queued while preflight ran",
    images: [],
  });
  assert.equal(getDraft(provisionalKey), null);
  assert.deepEqual(getDraft(sessionKey), {
    value: "queued while preflight ran",
    images: [],
  });

  clearDraft(sessionKey);
});

test("rekey keeps a synchronously restored draft when React state is still empty", () => {
  const provisionalKey = "new:/tmp/rekey-race";
  const sessionKey = "session-rekey-race";
  clearDraft(provisionalKey);
  clearDraft(sessionKey);
  setDraft(provisionalKey, { value: "restored before state flush", images: [] });

  assert.deepEqual(
    rekeyDraft(provisionalKey, sessionKey, { value: "", images: [] }),
    { value: "restored before state flush", images: [] },
  );
  assert.equal(getDraft(provisionalKey), null);
  assert.deepEqual(getDraft(sessionKey), {
    value: "restored before state flush",
    images: [],
  });

  clearDraft(sessionKey);
});

test("renders compact errors above the input as a wrapping alert", () => {
  const error = "Compaction failed: OpenAI API error (403): <html>request forbidden</html>";
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onCompact() {},
        isStreaming: false,
        compactError: error,
      }),
    ),
  );

  assert.match(html, /role="alert"/);
  assert.match(html, /Compaction failed: OpenAI API error/);
  assert.match(html, /&lt;html&gt;request forbidden&lt;\/html&gt;/);
  assert.match(html, /white-space:pre-wrap/);
  assert.ok(html.indexOf('role="alert"') < html.indexOf("<textarea"));
});
