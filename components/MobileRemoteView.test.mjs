import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { MobileRemoteView, classifyAgentEvent } = await jiti.import("./MobileRemoteView.tsx");
const { INITIAL_STREAMING_STATE, streamReducer } = await jiti.import("../lib/streaming-message.ts");
const { projectAssistantBlocks } = await jiti.import("../lib/mobile-state.ts");
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

test("keeps the new task control inside the composer, left of the input", () => {
  // 同一行里的顺序：新建任务 → 输入框 → 发送。
  const newTask = viewSource.indexOf('t("mobile.newTask")');
  const input = viewSource.indexOf("<textarea");
  const send = viewSource.indexOf('t("mobile.send")');

  assert.ok(newTask > 0 && input > 0 && send > 0, "composer controls not found");
  assert.ok(newTask < input && input < send, `unexpected order: newTask=${newTask} input=${input} send=${send}`);
  // 三者共用一个带边框的容器，底部对齐。
  assert.match(viewSource, /display: "flex", alignItems: "flex-end", gap: 6, padding: 6,/);
});

test("shows the sent message immediately instead of waiting for the run to finish", () => {
  // 发送成功后先在本地插一条气泡，快照要到 prompt_done 之后才有这条消息。
  assert.match(viewSource, /const \[pending, setPending\] = useState<MobileMessage\[\]>\(\[\]\)/);
  assert.match(viewSource, /const timeline = useMemo\(\(\) => buildMobileTimeline\(\[\.\.\.messages, \.\.\.pending\]\), \[messages, pending\]\)/);
  assert.match(viewSource, /id: `pending-\$\{pendingIdRef\.current\+\+\}`, role: "user", text, at: formatClock\(sentAt\)/);
  assert.match(viewSource, /reconcilePendingUserMessages\(previous, data\.messages, knownIds\)/);
  // 接管用的是「新增 id」，不能把刚写回的引用传进去。
  assert.match(viewSource, /const knownIds = new Set\(seenMessageIdsRef\.current\);\s*\n\s*for \(const message of data\.messages\) seenMessageIdsRef\.current\.add\(message\.id\);/);
  // 新建任务时要清掉旧的待确认气泡。
  assert.match(viewSource, /setSnapshot\(null\);\s*\n\s*setInput\(""\);\s*\n\s*setPending\(\[\]\);/);
  // 空态不能在有待确认气泡时抢镜。
  assert.match(viewSource, /const transcriptEmpty = messages\.length === 0 && pending\.length === 0 && !liveTail/);
});

test("keeps the streamed tail until the snapshot that replaces it arrives", () => {
  // 跑完先让快照接管再收尾巴：内容不会先消失再出现，新挂起的折叠组也在同一帧
  // 直接是收起状态（否则会看到「展开的详情闪一下再折回去」）。
  assert.match(viewSource, /const settled = data\.status !== "running";\s*\n\s*if \(settled\) dispatch\(\{ type: "end" \}\);/);
  assert.match(viewSource, /void refreshRef\.current\(\)\.then\(\(settled\) => \{\s*\n\s*if \(!settled\) dispatch\(\{ type: "end" \}\);\s*\n\s*\}\);/);
  assert.doesNotMatch(viewSource, /payload\.type === "prompt_done" \|\| payload\.type === "agent_settled"\) \{\s*\n\s*dispatch\(\{ type: "end" \}\);/);
});

test("pages back through history instead of hard-stopping at 30 messages", () => {
  // 窗口大小是状态，请求里带上它；「载入更早」一批批往回长。
  assert.match(viewSource, /const \[limit, setLimit\] = useState\(MOBILE_DEFAULT_LIMIT\)/);
  assert.match(viewSource, /new URLSearchParams\(\{ limit: String\(limit\) \}\)/);
  assert.match(viewSource, /setLimit\(\(value\) => Math\.min\(value \+ MOBILE_LIMIT_STEP, MOBILE_MAX_LIMIT\)\)/);
  assert.match(viewSource, /const loadEarlier = useCallback\(\(\) => \{/);
  assert.match(viewSource, /t\("mobile\.loadEarlier", \{ count: earlierCount \}\)/);
  assert.match(viewSource, /t\("mobile\.historyCapped"\)/);
  assert.match(viewSource, /const earlierCount = snapshot\?\.earlierCount \?\? 0/);
  // 加载完把用户看到的那条钉在原地，而不是跳走（头部变化时按高度差回抵）。
  assert.match(viewSource, /container\.scrollTop = container\.scrollHeight - previous\.scrollHeight \+ previous\.scrollTop/);
  assert.match(viewSource, /previous\.headId !== headId && !stickToBottomRef\.current/);
  // SSE 只跟会话绑定，窗口变化不应该重订事件流。
  assert.match(viewSource, /void refreshRef\.current\(\)\.then\(\(settled\) => \{/);
  assert.match(viewSource, /\}, \[sessionId\]\);/);
});

test("follows the desktop instead of waiting for a snapshot that never comes", () => {
  // 桌面端（CLI / 扩展）开始的这一轮：先同步运行状态，等首段正文流进来再补一次
  // （提问那时才落盘）。
  assert.match(viewSource, /case "start":[\s\S]{0,320}?void refreshRef\.current\(\);/);
  assert.match(viewSource, /syncOnFirstDeltaRef\.current = true;/);
  assert.match(viewSource, /if \(syncOnFirstDeltaRef\.current\) \{\s*\n\s*syncOnFirstDeltaRef\.current = false;\s*\n\s*void refreshRef\.current\(\);/);
  // 运行中从另一边又发了一条（排队 / 插话），正文只在快照里。
  assert.match(viewSource, /case "sync":[\s\S]{0,200}?void refreshRef\.current\(\);/);
  // 断线期间的事件不会重放：重连成功、网络回来、运行中静默超时各补一次快照。
  assert.match(viewSource, /source\.onopen = \(\) => \{[\s\S]*?firstOpen[\s\S]*?void refreshRef\.current\(\);/);
  assert.match(viewSource, /window\.addEventListener\("online", onOnline\)/);
  assert.match(viewSource, /lastEventAtRef\.current = Date\.now\(\);/);
  assert.match(viewSource, /const timer = window\.setInterval\(\(\) => \{[\s\S]*?Date\.now\(\) - last < IDLE_STREAM_REFRESH_MS[\s\S]*?void refreshRef\.current\(\);/);
  // 页面在后台时不自己发请求。
  assert.match(viewSource, /if \(document\.visibilityState === "hidden"\) return;/);
});

test("lets the composer shrink back after a multi-line message is sent", () => {
  // 自增长高度是直接写 style 的，清空时必须手动复位，否则发完还一直高着。
  assert.match(viewSource, /const composerRef = useRef<HTMLTextAreaElement>\(null\)/);
  assert.match(viewSource, /if \(input !== ""\) return;\s*\n\s*const element = composerRef\.current;\s*\n\s*if \(element\) element\.style\.height = "auto";/);
  assert.match(viewSource, /<textarea\s*\n\s*ref=\{composerRef\}/);
  // 上限是 3 行（16px × 1.5 × 3 + 内边距 16），再长在框内滚动。
  assert.match(viewSource, /const COMPOSER_MAX_HEIGHT = 88;/);
  assert.match(viewSource, /Math\.min\(element\.scrollHeight, COMPOSER_MAX_HEIGHT\)/);
  assert.match(viewSource, /maxHeight: COMPOSER_MAX_HEIGHT/);
});

test("never lets a server-picked session override the scanned one", () => {
  // URL 是唯一真相：参数读出前不发请求，且服务端挑中的会话只能在 URL 未指定时接管。
  assert.match(viewSource, /if \(!target\) return false;/);
  assert.match(viewSource, /if \(!target\.session && data\.sessionId\)/);
  assert.match(viewSource, /if \(target\.session\) query\.set\("session", target\.session\)/);
});

test("reads the session snapshot instead of shipping demo data", () => {
  assert.match(viewSource, /fetch\(`\/api\/mobile\/state\?\$\{query\.toString\(\)\}`\)/);
  assert.doesNotMatch(viewSource, /DEMO_|Demo data/);
  // 快照接口在服务端就把消息压成纯文本，并给出「还剩多少条更早的」和详情窗口。
  assert.match(stateRouteSource, /buildMobileWindow\(context\.messages, context\.entryIds, limit, \{\s*\n\s*detailWindow: MOBILE_DETAIL_WINDOW,\s*\n\s*\}\)/);
  assert.match(stateRouteSource, /earlierCount = window\.earlierCount/);
  assert.match(stateRouteSource, /const MAX_LIMIT = MOBILE_MAX_LIMIT/);
  assert.match(stateRouteSource, /^\s+earlierCount,$/m);
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
  assert.match(viewSource, /switch \(classifyAgentEvent\(payload\)\)/);
  assert.match(viewSource, /document\.addEventListener\("visibilitychange", handleVisibility\)/);
  assert.match(viewSource, /void refresh\(\);/);
});

test("maps every stream event to one action", () => {
  assert.equal(classifyAgentEvent({ type: "agent_start" }), "start");
  assert.equal(classifyAgentEvent({ type: "queue_update" }), "sync");
  assert.equal(classifyAgentEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta" } }), "delta");
  // 没有正文的事件不产生动作，免得空转。
  assert.equal(classifyAgentEvent({ type: "message_update" }), "ignore");
  assert.equal(classifyAgentEvent({ type: "prompt_done" }), "settle");
  assert.equal(classifyAgentEvent({ type: "agent_settled" }), "settle");
  assert.equal(classifyAgentEvent({ type: "tool_execution_update" }), "ignore");
  assert.equal(classifyAgentEvent({}), "ignore");
});

test("seeds the streaming bubble, without which every delta is dropped", () => {
  const text = [{ type: "text_start", contentIndex: 0 }, { type: "text_delta", contentIndex: 0, delta: "先看" }];

  // 只走 start + delta：`streamReducer` 会在没有 streamingMessage 时丢弃每条 delta，
  // 手机端就会“没有流式输出，等这轮结束才一下子全出来”。
  let withoutSnapshot = streamReducer(INITIAL_STREAMING_STATE, { type: "start" });
  for (const event of text) withoutSnapshot = streamReducer(withoutSnapshot, { type: "delta", event });
  assert.equal(withoutSnapshot.streamingMessage, null);

  // 桌面端的做法：message_start 先 dispatch 一次 snapshot。
  assert.equal(classifyAgentEvent({ type: "message_start", message: { role: "assistant", content: [] } }), "snapshot");
  assert.equal(classifyAgentEvent({ type: "message_start", message: { role: "user", content: "hi" } }), "ignore");
  assert.equal(classifyAgentEvent({ type: "message_start" }), "ignore");

  let withSnapshot = streamReducer(INITIAL_STREAMING_STATE, { type: "start" });
  withSnapshot = streamReducer(withSnapshot, { type: "snapshot", message: { role: "assistant", content: [], timestamp: 1 } });
  for (const event of text) withSnapshot = streamReducer(withSnapshot, { type: "delta", event });

  assert.deepEqual(withSnapshot.streamingMessage.content, [{ type: "text", text: "先看" }]);
  // 同一份内容会走 liveTail 投影渲染到界面上。
  assert.equal(projectAssistantBlocks(withSnapshot.streamingMessage.content).text, "先看");
});

test("picks up a run that was already streaming when the phone attached", () => {
  assert.equal(classifyAgentEvent({ type: "connected", isStreaming: true }), "start");
  assert.equal(classifyAgentEvent({ type: "connected", isStreaming: false }), "ignore");
  assert.equal(classifyAgentEvent({ type: "connected" }), "ignore");
});

test("keeps the phone bundle free of the desktop renderers", () => {
  for (const heavy of ["MarkdownBody", "ChatMinimap", "FileExplorer", "TerminalPanel", "MermaidBlock"]) {
    assert.doesNotMatch(viewSource, new RegExp(`from "\\./${heavy}"`), `${heavy} must not load on /m`);
    assert.doesNotMatch(pageSource, new RegExp(`from "\\.\\./components/${heavy}"`), `${heavy} must not load on /m`);
  }
  // 助手正文走轻量 markdown；用户消息保持原文 pre-wrap。
  assert.match(viewSource, /import \{ MobileMarkdown \} from "\.\/MobileMarkdown"/);
  assert.match(viewSource, /<MobileMarkdown text=\{item\.answer\.text\} cwd=\{cwdLabel \|\| null\} \/>/);
  assert.match(viewSource, /<MobileMarkdown text=\{liveTail\.text\} cwd=\{cwdLabel \|\| null\} streaming \/>/);
  // 一轮里的过程折进「处理详情」：历史轮默认收起，在跑的那一轮传 running 展开、跑完自动收起。
  assert.match(viewSource, /import \{ MobileProcessDetails \} from "\.\/MobileProcessDetails"/);
  assert.match(viewSource, /const timeline = useMemo\(\(\) => buildMobileTimeline\(\[\.\.\.messages, \.\.\.pending\]\), \[messages, pending\]\)/);
  assert.match(viewSource, /<MobileProcessDetails\s*\n\s*messageCount=\{item\.messageCount\}\s*\n\s*toolCallCount=\{item\.toolCallCount\}\s*\n\s*running=\{inFlight\}/);
  assert.match(viewSource, /const inFlight = running && index === timeline\.length - 1/);
  // 思考与工具：都在折叠组里，工具行可以单独展开。
  assert.match(viewSource, /import \{ MobileThinking, MobileToolList \} from "\.\/MobileProcessParts"/);
  assert.match(viewSource, /\{message\.thinking && <MobileThinking text=\{message\.thinking\} \/>\}/);
  assert.match(viewSource, /\{liveTail\.thinking && <MobileThinking text=\{liveTail\.thinking\} \/>\}/);
  assert.match(viewSource, /<MobileToolList calls=\{message\.tools\} \/>/);
  // 流式尾巴那一组跟着 streaming.isStreaming 展开/收起。
  assert.match(viewSource, /running=\{streaming\.isStreaming\}/);
  // 手机上的输入框必须 ≥16px，否则 iOS 聚焦会整页放大。
  assert.match(viewSource, /fontSize: 16/);
});
