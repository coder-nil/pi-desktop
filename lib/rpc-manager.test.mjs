import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("RPC session startup preloads extension-registered providers before restoring models", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(startupSource, /createAgentSessionServices\(/);
  assert.match(startupSource, /createAgentSessionFromServices\(/);
  assert.doesNotMatch(startupSource, /await createAgentSession\(/);
});

test("RPC session startup registers the host system-time tool", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(source, /import \{ createSystemTimeExtension \} from "\.\/system-time-tool"/);
  assert.match(startupSource, /extensionFactories: \[[\s\S]*?createSystemTimeExtension\(\)/);
});

test("RPC session startup registers the Desktop task-progress tool", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(source, /import \{ createTaskProgressExtension \} from "\.\/task-progress-tool"/);
  assert.match(startupSource, /extensionFactories: \[[\s\S]*?createTaskProgressExtension\(\)/);
});

test("RPC session startup resolves and passes the SDK-native enabled model scope", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));
  const resolveIndex = startupSource.indexOf("resolveVisibleModels(");
  const createIndex = startupSource.indexOf("createAgentSessionFromServices(");

  assert.ok(resolveIndex >= 0);
  assert.ok(createIndex > resolveIndex);
  assert.match(startupSource, /selectInitialModelScope\(/);
  assert.match(startupSource, /scopedModels: initial\.scopedModels/);
  assert.match(startupSource, /model: initial\.model/);
  assert.match(startupSource, /thinkingLevel: initial\.thinkingLevel/);
});

test("RPC session startup treats only sessions with messages as continuing", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(
    startupSource,
    /const hasExistingMessages = sessionManager\.getBranch\(\)\.some\(\(entry\) => entry\.type === "message"\)/,
  );
  assert.match(startupSource, /const initial = hasExistingMessages/);
  assert.doesNotMatch(startupSource, /const initial = sessionFile/);
  assert.doesNotMatch(startupSource, /sessionManager\.buildSessionContext\(\)/);
});

test("RPC session startup opens an existing session file only once and trusts its cwd", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));
  const routeSource = await readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");
  const eventRouteSource = await readFile(new URL("../app/api/agent/[id]/events/route.ts", import.meta.url), "utf8");
  const autoNameRouteSource = await readFile(new URL("../app/api/sessions/[id]/auto-name/route.ts", import.meta.url), "utf8");

  assert.equal((startupSource.match(/SessionManager\.open\(/g) ?? []).length, 1);
  assert.match(startupSource, /const sessionCwd = sessionManager\.getCwd\(\)/);
  assert.match(startupSource, /projectTrustReloadOptions\(sessionCwd, agentDir\)/);
  assert.match(startupSource, /cwd: sessionCwd/);
  for (const route of [routeSource, eventRouteSource, autoNameRouteSource]) {
    assert.doesNotMatch(route, /SessionManager\.open\(/);
  }
});

test("RPC wrapper avoids per-chunk idle and running-state maintenance", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startSource = source.slice(
    source.indexOf("  start(): void"),
    source.indexOf("  setForceEmptySystemPrompt"),
  );
  const notifySource = source.slice(
    source.indexOf("export function notifyRunningChange"),
    source.indexOf("export async function startRpcSession"),
  );

  assert.match(startSource, /IDLE_RESET_EVENT_TYPES\.has\(event\.type\)/);
  assert.match(startSource, /RUNNING_STATE_EVENT_TYPES\.has\(event\.type\)/);
  assert.doesNotMatch(startSource, /subscribe\(\(event: AgentEvent\) => \{\s*this\.resetIdleTimer\(\)/);
  assert.match(notifySource, /if \(listeners\.size === 0\)/);
  assert.match(notifySource, /lastRunningSnapshot = ""/);
});

test("normal session teardown paths use graceful extension shutdown", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const deleteRouteSource = await readFile(new URL("../app/api/sessions/[id]/route.ts", import.meta.url), "utf8");
  const trustRouteSource = await readFile(new URL("../app/api/project-trust/route.ts", import.meta.url), "utf8");
  const idleSource = source.slice(
    source.indexOf("  private resetIdleTimer"),
    source.indexOf("  private persistBashOnlySession"),
  );
  const forkSource = source.slice(
    source.indexOf('case "fork"'),
    source.indexOf('case "navigate_tree"'),
  );

  assert.match(idleSource, /this\.shutdown\(\)/);
  assert.match(forkSource, /await this\.shutdown\(\)/);
  assert.match(deleteRouteSource, /await getRpcSession\(id\)\?\.shutdown\(\)/);
  assert.match(trustRouteSource, /await destroyRpcSessionsForCwd\(result\.cwd\)/);
});

test("new-session route applies model scope during construction instead of follow-up commands", async () => {
  const source = await readFile(new URL("../app/api/agent/new/route.ts", import.meta.url), "utf8");

  assert.match(source, /initialModel: \{ provider, modelId \}/);
  assert.match(source, /thinkingLevel: explicitThinkingLevel/);
  assert.doesNotMatch(source, /session\.send\(\{ type: "set_model"/);
  assert.doesNotMatch(source, /session\.send\(\{ type: "set_thinking_level"/);
  assert.match(source, /model: state\.model/);
  assert.match(source, /thinkingLevel: state\.thinkingLevel/);
});

test("prompt routes mark only preflight failures as rejected", async () => {
  const existingRoute = await readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");
  const newRoute = await readFile(new URL("../app/api/agent/new/route.ts", import.meta.url), "utf8");

  for (const source of [existingRoute, newRoute]) {
    assert.match(source, /let promptAccepted = false/);
    assert.match(source, /await .*\.send\(/);
    assert.match(source, /promptAccepted = .*\.type === "prompt"/);
    assert.match(source, /commandType === "prompt" && !promptAccepted/);
  }
});

test("RPC session startup persists explicit preferences without replaying setters", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(startupSource, /persistExplicitStartupPreferences\(/);
  assert.match(startupSource, /modelDefaultChanged\) invalidateModelsCache\(\)/);
});

test("custom extension UI receives the fixed headless terminal facade", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const customUiSource = source.slice(
    source.indexOf("private requestExtensionCustomUi"),
    source.indexOf("private requestExtensionUi"),
  );

  assert.match(customUiSource, /createHeadlessCustomUiTui\(/);
  assert.match(customUiSource, /width,/);
});

test("reloading a session invalidates the models cache", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const reloadSource = source.slice(
    source.indexOf('case "reload"'),
    source.indexOf('case "abort_compaction"'),
  );

  assert.match(reloadSource, /await this\.inner\.reload\(\)/);
  assert.match(reloadSource, /this\.applyForcedEmptySystemPrompt\(\);[\s\S]*?invalidateModelsCache\(\)/);
});

test("agent state exposes pending extension UI requests", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const stateSource = source.slice(
    source.indexOf('case "get_state"'),
    source.indexOf('case "set_ui_locale"'),
  );

  assert.match(stateSource, /pendingUiRequests: \[\.\.\.this\.pendingUiRequests\.values\(\)\]/);
});

test("RPC sessions retry individual provider requests without rerunning an agent turn", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const retrySource = source.slice(
    source.indexOf("const DESKTOP_PROVIDER_REQUEST_MAX_RETRIES"),
    source.indexOf("const RUNNING_STATE_EVENT_TYPES"),
  );
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));
  const reloadSource = source.slice(
    source.indexOf("private async reloadResourcesBeforePrompt"),
    source.indexOf("private resetIdleTimer"),
  );

  assert.match(retrySource, /const DESKTOP_PROVIDER_REQUEST_MAX_RETRIES = 5/);
  assert.match(retrySource, /retry: \{[\s\S]*?provider: \{ maxRetries: 0 \}/);
  assert.doesNotMatch(retrySource, /enabled: false/);
  assert.match(retrySource, /fetch: withProviderRequestRetry\(options\?\.fetch \?\? globalThis\.fetch\)/);
  assert.match(retrySource, /input instanceof Request \? input\.clone\(\) : input/);
  assert.match(retrySource, /response\.ok \|\| retry >= DESKTOP_PROVIDER_REQUEST_MAX_RETRIES/);
  assert.doesNotMatch(retrySource, /_isRetryableError|agent\.continue/);
  assert.match(startupSource, /configureDesktopProviderRetry\(inner\)/);
  assert.match(reloadSource, /await this\.inner\.reload\([\s\S]*?configureDesktopProviderRetry\(this\.inner\)/);
});

test("broadcasts that a pending extension UI request is gone", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const requester = source.slice(
    source.indexOf("private requestExtensionUi"),
    source.indexOf("private createExtensionUiContext"),
  );

  // 唯一的出口 cleanup：被回答 / 超时 / 被中止 / 被取消都从这里走，
  // 广播放在这里，另一边不必等 15s 状态对账。
  assert.match(requester, /const announceResolved = \(\) => \{/);
  assert.match(requester, /this\.emit\(\{ type: "extension_ui_resolved", id \} as AgentEvent\)/);
  assert.match(requester, /this\.pendingUiRequests\.delete\(id\);[\s\S]{0,80}?announceResolved\(\);/);
  assert.match(requester, /if \(announced\) return;\s*\n\s*announced = true;/);

  // 回答本身只负责唤醒 Promise，不再单独广播一份（避免两个发射点）。
  const resolver = source.slice(
    source.indexOf("private resolveExtensionUiResponse"),
    source.indexOf("private getExtensionStatuses"),
  );
  assert.match(resolver, /pending\.resolve\(response\)/);
  assert.doesNotMatch(resolver, /extension_ui_resolved/);
});

test("running snapshot carries sessions waiting on extension UI", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const snapshotSource = source.slice(
    source.indexOf("export function getRunningRpcSessionsSnapshot"),
    source.indexOf("export function getRunningRpcSessionIds"),
  );
  const startSource = source.slice(
    source.indexOf("  start(): void"),
    source.indexOf("  setForceEmptySystemPrompt"),
  );

  assert.match(snapshotSource, /session\.hasPendingUiRequests\(\)/);
  assert.match(snapshotSource, /pendingUiSessionIds: \[\.\.\.pendingUi\]/);
  assert.match(startSource, /event\.type === "extension_ui_request"/);
  assert.match(startSource, /event\.type === "extension_ui_resolved"/);
});

test("replays pending extension UI requests to a late listener", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const onEvent = source.slice(source.indexOf("  onEvent(listener"), source.indexOf("  onDestroy(cb"));

  // 手机端中途接上（或页面刷新）时，还没回答的 ask_user 必须能重新拿到。
  assert.match(onEvent, /for \(const event of this\.pendingUiRequests\.values\(\)\) listener\(event\)/);
});
