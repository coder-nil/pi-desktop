# Pi Desktop - Development Notes

## Quick Start

```bash
npm run dev   # port 30141
```

Typecheck: `node_modules/.bin/tsc --noEmit`  
Lint: `npm run lint`  
**Never run `next build` during dev** — pollutes `.next/` and breaks `npm run dev`.

---

## Architecture

```
Browser                Next.js Server              AgentSession (in-process)
  │                        │                               │
  ├─ GET /api/sessions ────▶ reads ~/.pi/agent/sessions/   │
  ├─ GET /api/sessions/[id] reads .jsonl file directly     │
  ├─ GET /api/agent/running ───────▶ running id snapshot   │
  │                        │                               │
  ├─ send message ─────────▶ POST /api/agent/[id]          │
  │                        │   startRpcSession() ─────────▶│ createAgentSession()
  │                        │   session.send(cmd) ─────────▶│ session.prompt()
  │                        │                               │
  ├─ SSE connect ──────────▶ GET /api/agent/[id]/events    │
  │                        │   session.onEvent() ◀─────────│ session.subscribe()
  │◀── data: {...} ─────────│                               │
```

**Session browsing** (read-only): reads `.jsonl` files through SDK `SessionManager` helpers and `lib/session-reader.ts` — no AgentSession created.  
**Sending a message**: `startRpcSession()` in `lib/rpc-manager.ts` creates an AgentSession in-process.

---

## File Map

```
app/api/
  sessions/route.ts               GET  list all sessions
  sessions/[id]/route.ts          GET/PATCH/DELETE session
  sessions/[id]/context/route.ts  GET ?leafId= — context for a specific leaf
  sessions/[id]/export/route.ts   GET exported HTML for a session
  agent/new/route.ts              POST { cwd, message, toolNames?, provider?, modelId? }
  agent/[id]/route.ts             GET state | POST any command
  agent/[id]/events/route.ts      GET SSE stream
  agent/running/route.ts          GET currently-running session ids
  agent/running/events/route.ts   GET SSE stream of currently-running session ids
  auth/all-providers/route.ts     GET API-key provider list
  auth/api-key/[provider]/route.ts GET/POST/DELETE provider API key status/storage
  auth/login/[provider]/route.ts  GET OAuth/device-code SSE | POST manual code
  auth/logout/[provider]/route.ts POST OAuth logout
  auth/providers/route.ts         GET OAuth provider list
  cwd/validate/route.ts           POST validate/select a cwd
  default-cwd/route.ts            POST create ~/pi-cwd-YYYYMMDD
  files/[...path]/route.ts        GET file contents for viewer
  home/route.ts                   GET user home directory
  models/route.ts                 GET { models, modelList, defaultModel }
  models-config/route.ts          GET/PUT — read/write ~/.pi/agent/models.json
  models-config/catalog/route.ts  GET models.dev pricing presets
  models-config/enabled/route.ts  GET provider models + picker state | PUT writes enabledModels
  mobile/pair/route.ts            GET LAN address + remote-view URL for the phone QR code
  mobile/access/route.ts          GET/PUT phone-access switch + password (writes desktop-access.json)
  models-config/discover/route.ts POST fetch a configured provider's upstream model list
  models-config/test/route.ts     POST test a configured model/provider
  plugins/route.ts                GET/POST package plugin management
  skills/route.ts                 GET/PATCH loaded skills and disable-model-invocation
  skills/install/route.ts         POST install skills through npx skills add
  skills/search/route.ts          GET/POST skills.sh search
  worktrees/route.ts              GET/POST/DELETE git worktrees

lib/
  agent-client.ts      typed fetch helper for /api/agent commands
  draft-store.ts       local draft persistence helpers
  file-access.ts       allowed file roots for /api/files and worktrees
  file-paths.ts        client/server path encoding helpers
  markdown.ts          shared markdown helpers
  mobile-state.ts      server-side plain-text projection for the phone view
  mobile-timeline.ts   turn grouping for /m: user → process → answer (+ MOBILE_RADIUS, pending takeover)
  npx.ts               npx runner used by skill install
  pi-types.ts          local structural types for pi SDK objects
  rpc-manager.ts      AgentSessionWrapper + registry + startRpcSession
  session-reader.ts   SessionManager wrappers + path cache + buildSessionContext adapter
  tool-presets.ts     PRESET_NONE/READ_ONLY/DEFAULT/FULL + getPresetFromTools()
  tool-preset-preference.ts  browser-persisted default for fresh sessions
  types.ts            shared TypeScript types
  normalize.ts        normalizeToolCalls() — field name mismatch between file format and our types
  worktree.ts         project/worktree resolution and git worktree operations

components/
  AppShell.tsx        layout + URL state + tab management
  SessionSidebar.tsx  session tree + FileExplorer
  ChatWindow.tsx      chat composition + completion sound wrapper
  ChatInput.tsx       input bar + model/thinking/tools/compact controls
  MessageView.tsx     renders one message (user/assistant/toolCall/toolResult)
  BranchNavigator.tsx in-session branch switcher
  ChatMinimap.tsx     scroll minimap alongside the message list
  MarkdownBody.tsx    markdown renderer
  ModelsConfig.tsx    modal for editing models.json (opened from sidebar bottom)
  EnabledModelsPicker.tsx  per-provider checklist for the chat model picker (writes enabledModels)
  MobilePairDialog.tsx  QR dialog that pairs a phone with the current session (opened from ChatInput)
  MobileAccessSettings.tsx  Settings → Phone access: switch, password, address and QR code
  MobileRemoteView.tsx  one-screen phone remote view (snapshot + SSE + send/stop/new task)
  MobileMarkdown.tsx    light markdown for /m: react-markdown + remark-gfm only
  MobileProcessDetails.tsx  "process details" group for /m (desktop wording; expanded while running)
  MobileProcessParts.tsx    thinking block + expandable tool-call rows for /m
  MobilePromptCard.tsx      blocking extension/ask_user prompt for /m (pinned above the composer)
  PluginsConfig.tsx   modal for installed package plugins
  SkillsConfig.tsx    modal for loaded/search/installable skills
  FileExplorer.tsx    file tree inside sidebar
  FileIcons.tsx       file icon helpers
  FileViewer.tsx      file content in a tab
  TabBar.tsx          tab bar (Chat + open file tabs)

hooks/
  useAgentSession.ts  messages + streaming + SSE + fork/navigate/reconciliation logic
  useAudio.ts         completion sound + browser AudioContext unlock
  useDragDrop.ts      shared drag/drop state
  useIsMobile.ts      responsive breakpoint hook
  useTheme.ts         theme state
```

---

## Key Design Decisions & Traps

### AgentSession lifecycle (`lib/rpc-manager.ts`)
- One `AgentSessionWrapper` per session id, keyed in `globalThis.__piSessions`
- `globalThis` survives Next.js hot-reload; plain module-level Map does not
- Idle timeout: 10 minutes. Concurrent `startRpcSession()` calls share a single start Promise (`globalThis.__piStartLocks`)

### Fork must destroy the wrapper immediately
`AgentSession.fork()` **mutates the wrapper's inner state in-place** — after fork, `inner.sessionId` is the *new* session's id. If the wrapper stays alive in the registry under the old id, the next request gets the already-forked state and subsequent forks produce a corrupt `parentSession` chain.

**Fix**: `send("fork")` captures `newSessionId`, then calls `this.destroy()` before returning. The next request for the original session reloads a clean AgentSession from the original file.

### Two kinds of branching — don't confuse them
- **Fork** (Fork button on user message): creates a new independent `.jsonl` file. Shown as a child in the sidebar tree via `parentSession` header field.
- **In-session branch** (Continue button / BranchNavigator): calls `navigate_tree` within the same file. Multiple entries share the same `parentId`. Switching between them calls `/api/sessions/[id]/context?leafId=`.

### Session files can be fully rewritten
`parentSession` in the header is **display metadata only** — has zero effect on chat content. Safe to `writeFileSync` the entire file (pi does this itself during migrations). Used when cascade-reparenting children on delete.

### ToolCall field normalization
Pi stores toolCall blocks as `{type:"toolCall", id, name, arguments}` but `ToolCallContent` uses `{toolCallId, toolName, input}`. `normalizeToolCalls()` in `lib/normalize.ts` handles this — called in both `session-reader.ts` (file load) and `ChatWindow.handleAgentEvent()` (streaming).

### New session tool preset
Tool names are passed at session creation (`POST /api/agent/new` → `toolNames[]`). For existing sessions, the active preset is inferred on mount via `get_tools` → `getPresetFromTools()`. When tools are fully disabled (`toolNames = []`), `rpc-manager.ts` passes an empty tool allow-list and forces `agent.state.systemPrompt = ""` after startup/reload/resource discovery.

The last preset explicitly selected by the user is stored in browser `localStorage` and initializes fresh-session composers only. Existing sessions never trust that preference; they use their live `get_tools` state or pi's default when no wrapper exists.

### Model defaults for new sessions
`GET /api/models` returns `defaultModel` read from `~/.pi/agent/settings.json`. `ChatWindow` pre-selects this on mount for new sessions. Explicit browser model/thinking selections are applied atomically during AgentSession construction, then `lib/startup-preferences.ts` persists their effective values without replaying `set_model`/`set_thinking_level`; implicit `enabledModels` fallbacks and thinking pins are not persisted.

### Application version is single-source
`package.json.version` is the only application version source. Bump it with `npm run version:set -- <version>`; that script synchronizes `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and the README UI version. Run `npm run version:check` afterward; CI also compares the release tag against the same source. Never hand-edit those derived version fields or hardcode the application version in runtime code; `next.config.ts` exposes it through `NEXT_PUBLIC_PACKAGE_VERSION`. `CHANGELOG.md` headings are historical release records and are intentionally not synchronized; add a new entry for each release instead of rewriting old ones.

### `enabledModels` scoping
The `enabledModels` setting uses pi's `--models` syntax: minimatch globs against `provider/modelId` or a bare `modelId`, fuzzy matching for non-glob patterns, and an optional `:thinkingLevel` suffix. Never compare those patterns as literal strings — `lib/model-scope.ts` delegates to the SDK's `resolveModelScopeWithDiagnostics()` so pi-desktop and the TUI agree on the visible model list, and falls back to all available models when patterns resolve to nothing. `startRpcSession()` resolves that scope before creating an AgentSession and passes the selected initial model, thinking pin, and SDK-native `scopedModels` atomically; `GET /api/models` reuses the helper only for selector data, `thinkingLevelPins`, and `modelScopeWarnings` display.

Settings → Models exposes the same mechanism per provider: `EnabledModelsPicker` lists a provider's available models and checks the ones that should appear in the chat model picker. `PUT /api/models-config/enabled` merges the new selection into the current visible set (other providers keep their visibility), then `lib/enabled-models.ts` compiles it back into patterns — `provider/*` for a fully selected provider, explicit `provider/modelId[:level]` otherwise, `undefined` when everything is selected, and pinned thinking levels are preserved rather than dropped. An empty pattern list is rejected: pi would resolve it to *every* model, the opposite of "hide everything". Saves go through `SettingsManager.setEnabledModels()` + `flush()` (the same settings.json the CLI reads), invalidate `lib/models-cache.ts`, and call `onSaved` so the open composer reloads its model list.

### SSE reconnect on page refresh mid-stream
On `ChatWindow` mount, `GET /api/agent/[id]` is called. If `state.isStreaming === true`, SSE is reconnected automatically. `thinkingLevel` and `isCompacting` are also synced from this response.

### Compaction SSE events
Newer pi emits `compaction_start` / `compaction_end`; older versions emitted `auto_compaction_start` / `auto_compaction_end`. `handleAgentEvent` accepts both sets to keep `isCompacting` in sync. Manual compact is a blocking POST — the button stays disabled until the response returns.

### Running state polling + reconciliation
- The sidebar polls `/api/agent/running` every 2.5 seconds while the tab is visible and pauses polling in background tabs. The session-list response remains the initial fallback.
- `useAgentSession` treats per-session SSE as primary for chat events and opens it before each prompt. `prompt_done` completes the current UI stage and notification immediately, but the idle SSE stays open for a 30-second grace window and is reused by the next prompt. `agent_start` cancels that close timer; `agent_settled` finishes extension-injected runs that have no wrapper-level `prompt_done` and starts a fresh grace window. Do not close on the first `agent_end`: retries, compaction, and extension-queued messages can continue the same logical prompt.
- While a run is active, `useAgentSession` periodically calls `GET /api/agent/[id]` and also reconciles on `visibilitychange`/`online`. This fixes missed terminal events from background tabs or half-open connections.
- Prompt runs use a monotonic run id; late SSE or slow reconciliation responses from an old run must be ignored so they cannot resurrect stale streaming bubbles.

### Worktrees and project grouping
- `lib/worktree.ts` resolves linked worktree top-levels back to the main repo `projectRoot`; `listAllSessions()` attaches that to each `SessionInfo` so all worktrees for one repo are grouped together in the sidebar.
- Worktree operations are served by `/api/worktrees` and guarded by the same allowed-root rules as `/api/files`.
- New worktrees are created under `<repoRoot>-worktrees/<sanitized-branch>`. Existing branches are reused; otherwise `git worktree add -b` creates the branch.
- Removing a dirty worktree returns `409` with `{ dirty: true }` so the UI can ask before retrying with `force`.
- Sessions whose cwd points at a removed worktree are inferred back into the main project instead of becoming a phantom project row.
- git prints POSIX-style absolute paths even on Windows, so every path read out of git goes through `toNativePath()` (`lib/paths.ts`) before it is compared or returned. Compare paths with `samePath()`, never `===` — raw equality made `isTopLevel` permanently false on Windows and hid the worktree switcher entirely. Branch names are not paths and must keep their forward slashes. Browser code cannot apply Node path rules, so `/api/worktrees` resolves `currentWorktreePath` server-side; the sidebar must use that identity for highlighting and removal fallback.

### File access allow-list
- `/api/files` is intentionally not a general filesystem browser. Allowed roots come from session cwds, their resolved project roots, `~/pi-cwd-*`, and roots explicitly added with `allowFileRoot()`.
- `/api/cwd/validate`, `/api/default-cwd`, and `/api/worktrees` call `allowFileRoot()` when they make a new location browsable.
- Allowed roots are stored slash-normalized, but that is a Set-key convention, not a correctness requirement: `isPathWithinRoots()` (`lib/path-security.ts`, the single implementation behind `isFilePathAllowed()`) re-resolves and case-folds both sides, so either path form authorizes correctly. Keep that one implementation — it is the security boundary.

### Plugins and skills
- `/api/plugins` uses pi's `SettingsManager` + `DefaultPackageManager` for global/project package install, remove, update, enable, and disable. Disabling writes empty `extensions/skills/prompts/themes` arrays for that package entry.
- `/api/skills` uses `DefaultResourceLoader` so settings paths, package skills, and project `.agents/skills` are listed the same way the runtime sees them.
- Skill toggling edits only the `disable-model-invocation` frontmatter key on the target `SKILL.md`; keep that surgical so user formatting survives.
- `/api/skills/install` shells through `npx skills add ... --agent pi`; project installs run with the selected cwd.

### Auth and model config
- `ModelsConfig` combines models from `~/.pi/agent/models.json` with provider auth status from pi's `AuthStorage`/`ModelRegistry`.
- Provider listing is capability-driven, never id-driven: `lib/provider-listing.ts` decides membership from `auth.apiKey.login` / `auth.oauth` plus the stored credential type, so dual-auth providers (anthropic and github-copilot today — which providers declare both changes between SDK releases, so never assume it from an id) appear exactly once and never fall through both lists (#309). `lib/provider-listing-runtime.ts` adapts `ModelRuntime` to those pure helpers.
- auth.json holds **one** credential per provider and `ModelRuntime.logout()` deletes whichever it is. The delete routes therefore use `removeStoredCredentialIfType()` to compare and delete under the same file lock used by pi's auth storage. `ModelsConfig` also refreshes *both* provider lists after any auth change — refreshing one leaves a dual-auth provider rendered twice.
- OAuth/device-code/manual-code flows are streamed by `GET /api/auth/login/[provider]`; manual code responses POST back with a short-lived token stored in `globalThis.__piLoginCallbacks`.
- API-key routes store and remove keys through `AuthStorage`. Status endpoints must never return the raw key: `GET /api/auth/api-key/[provider]` reads the stored key server-side and returns only `api-key-mask.ts`'s masked hint (same length as the key, last four characters exposed, short keys fully hidden). The settings page pre-fills that mask into the single editable input (`revealed`, selected on focus) and must never post the mask back as a key.
- The model test route is `app/api/models-config/test/route.ts`; `app/api/models/test/` is not a real route.

### models.dev catalog cache is disk-backed and never awaited on UI paths
- `lib/models-dev-discovery.ts` resolves the catalog as memory → `pi.sqlite` → network. `models_dev_catalog` (see `lib/models-dev-catalog-store.ts`) holds the flattened entries plus `fetched_at`; a disk hit returns immediately, and an expired entry is still served while a deduplicated background refresh (5 minute backoff after a failure) replaces it. Nothing on a request path ever waits for the multi-MB `models.dev/api.json`.
- `/api/auth/all-providers`, `/api/models`, and `startRpcSession()` call `refreshDesktopProviderCatalogs()` as fire-and-forget and render from `models-store.json` plus the catalog cache. The DeepSeek provider's `refreshModels` stays cache-first and passes `offline` on cache-only refreshes, which is what keeps the settings model list from going empty while the network catches up.

### Coding (apisets) discovers models from its upstream API only
`providers/apisets` has no static model table: `apiSetsModels()` parses the upstream `/v1/models` response (`{ data: [...] }`) and must stamp `provider`/`api`/`baseUrl` onto every entry, because the parsed list is what gets persisted. `refreshModels()` restores that persisted list on cache-only refreshes, skips the upstream call while `checkedAt` is inside a 30 minute window (unless `force`), and publishes `persist: { etag: "apisets-models-api-v2" }` after a network refresh — bump that etag whenever the persisted shape changes. `createDesktopModelRuntime()` awaits a cache-only refresh for both Coding and DeepSeek, because every API request builds a fresh runtime: without persisted models the provider renders with an empty list and the chat model picker silently loses it.

### Phone remote view (`/m`) is a separate, deliberately thin route
- `app/m/page.tsx` renders `MobileRemoteView` inside its own `I18nProvider` (the root layout has none) and must stay free of the desktop renderers — `components/MobileRemoteView.test.mjs` asserts that `MarkdownBody`, `ChatMinimap`, `FileExplorer`, `TerminalPanel` and `MermaidBlock` are never imported there. The input keeps `fontSize: 16` so iOS does not zoom on focus. That textarea grows with its content up to `COMPOSER_MAX_HEIGHT` (88px = 3 lines at 16px/1.5, beyond that it scrolls inside the box) and its height is written imperatively, so the empty-input effect **must** reset `style.height` to `auto`: without it the box stayed at 3 lines after every multi-line send, and the keyboard leaves so little room that the taller composer eats the transcript.
- Assistant prose is rendered by `components/MobileMarkdown.tsx`, which deliberately carries only `react-markdown` + `remark-gfm` (same `singleTilde: false` option as the desktop, so CJK ranges like `5~7U` stay literal). No syntax highlighting, KaTeX, mermaid or `rehype-raw`, and it never imports `MarkdownBody` or `lib/markdown.ts` (that module pulls katex/raw/sanitize in at module level). Raw HTML from the model therefore lands as visible text. Phone-specific rendering rules: fenced code gets a language label plus a copy button, tables go through `.markdown-table-wrap`, local file links degrade to monospace text (a phone cannot open them, and a dead link would navigate away from the remote view), and the streaming caret is a `::after` on the last block of `.markdown-body.mobile-streaming`. User messages stay plain `pre-wrap` in their bubble: pasted logs and code should not be rewritten as markdown. `components/MobileMarkdown.test.mjs` pins all of this.
- The transcript is grouped per turn by `lib/mobile-timeline.ts` (pure, unit-tested): user bubble → one `MobileProcessDetails` group → final answer. The group carries the desktop's exact wording (`chat.processDetails` + `N messages` + `N tool calls`, joined with ` · `) and the same chevron. Its default state is driven by the `running` prop the phone passes for the turn that is still executing: that group is expanded so thinking and tool calls can be watched live, and it folds shut the moment `running` flips to false ("collapse when the run ends"). History turns are collapsed. A turn's intermediate assistant entries (their prose included) plus the final answer's own tool calls all live inside the group; only the answer text stays outside. Collapsed children are not rendered at all, so a long tool history costs nothing until it is opened.
- Inside the group `components/MobileProcessParts.tsx` renders thinking (`MobileThinking`, labelled with `i18n.thinking`, muted text) and tool calls (`MobileToolList`): one row per call (`name` + hint, failed calls in `--danger`), expandable when the projection attached `input`/`output`. Both come from `lib/mobile-state.ts`, which keeps thinking (`MobileMessage.thinking`, truncated to 1200 chars) and pairs each tool result back to its call by `toolCallId` (`output` truncated to 800 chars, `input` to 600) instead of dropping results. Rendering order inside one assistant entry is fixed (thinking → tools → prose); the block order of the original entry is not preserved.
- Run end is ordered: `refresh()` returns `settled` and does `setSnapshot()` + `dispatch({ type: "end" })` together, so the snapshot replaces the streamed tail in the same frame instead of the text vanishing and reappearing. The SSE handler's `prompt_done` / `agent_settled` only falls back to `dispatch({ type: "end" })` when that refresh did not come back.
- Snapshot refresh triggers *are* the phone's sync story, because nothing else updates it: `agent_start` (a run someone else started — desktop, CLI or an extension), the **first streamed delta of that run**, `queue_update` (a prompt queued from the other side), `onopen` after an SSE reconnect (events during a disconnect are never replayed), `online`, a 20 s silence watchdog while running (a half-open socket never fires `onerror`), `prompt_done` / `agent_settled`, and `visibilitychange`. The first-delta hop is not redundant: pi emits `agent_start` *before* persisting the prompt (`message_end` fires before the session file gets the entry), so a snapshot taken on `agent_start` still lacks the question; by the first delta it is on disk. `classifyAgentEvent()` maps event → action and is unit-tested — add new triggers there instead of growing ad-hoc branches in the SSE effect. The reverse direction is asymmetric: the desktop re-attaches its SSE within ~2.5 s of the sidebar's running poll, but it has no optimistic bubble for a prompt typed on the phone (it reloads the session on `agent_end`).
- A sent prompt is inserted locally as a pending user bubble the moment the POST succeeds, because the snapshot is only refetched on `prompt_done` / `agent_settled` / `visibilitychange` — without it the phone would show nothing of its own message until the whole run finished. `reconcilePendingUserMessages()` (same module) retires that bubble only when a snapshot contains a **new** user entry id with the same text, so duplicate prompts like "继续" are not matched against the older entry and the bubble never vanishes early. The pending list is part of the timeline input (`buildMobileTimeline([...messages, ...pending])`), so the streaming tail lands inside the turn that bubble opened.
- Blocking extension UI requests reach the phone too, which is what keeps `ask_user` from stalling a run: the tool calls `ctx.ui.select/confirm/input/editor`, `requestExtensionUi()` emits `extension_ui_request` and waits (forever, when the model passed no `timeoutMs`), and a phone that ignores that event leaves the run hanging with nothing on screen. `GET /api/mobile/state` therefore carries `pendingUiRequest` (the first blocking entry of `get_state().pendingUiRequests`, `pickPendingUiRequest()` skips notify/setStatus/setWidget) and `MobilePromptCard` renders it pinned **above** the composer. The card comes straight from the `extension_ui_request` payload (`blockingUiRequestFromEvent()`) so it appears without waiting for a snapshot, and `pendingUiRequest` in the snapshot is the authoritative reconciliation. The answer is the same `POST /api/agent/[id] { type: "extension_ui_response", id, value|confirmed|cancelled }` the desktop sends, so both clients share one answer: whoever answers first wins, and `requestExtensionUi()`'s `cleanup()` emits `extension_ui_resolved { id }` — from the single exit every settle path goes through, so a timeout or an abort closes the other side's dialog too, not just a real answer. Both the desktop's event handler and its two state-reconciliation paths clear a dialog whose id is no longer pending, and `ExtensionDialog` resets its input on `request.id` (not the request object) because reconciliation hands it a fresh object every 15 s.
- Step 2 is wired: `GET /api/mobile/state` returns one snapshot — session picked as *running → most recently modified* (scoped by the QR's `cwd`), messages already projected server-side by `lib/mobile-state.ts` (tool calls collapsed to one `name hint` line, tool results paired back by `toolCallId`, long text truncated). `limit` is the size of the newest slice (default 30, cap 300) and the response carries `earlierCount`, which is what the phone's "load earlier" button pages back with; the window never grows on its own, so the phone is not a full-history browser. Beyond `MOBILE_DETAIL_WINDOW` (40) messages the projection is skimmed by `skimMobileMessage()` — thinking and tool `input`/`output` are dropped, `name`/`hint`/`isError` stay — because 300 detailed messages measured ~500KB versus ~140KB skimmed. The page then streams progress over `/api/agent/[id]/events` and only ever writes through the existing `POST /api/agent/[id]` (`prompt` / `abort`) and `POST /api/agent/new`. No new write endpoints exist for the phone.
- Idle-grace detail worth keeping: `MobileRemoteView` ignores the server-picked session once for the refresh that follows `startNewTask()`, otherwise the phone bounces straight back into the session the user just left. The flag is cleared when the send creates the new session.
- The page reads `session` / `cwd` from the URL, disconnects SSE when hidden and re-snapshots on `visibilitychange`, and renders the streaming tail from `lib/streaming-message.ts`'s reducer so it looks identical to the desktop. **`message_start` must be forwarded to `dispatch({ type: "snapshot" })`** (it is what the desktop does too): `streamReducer`'s `updateContentBlock` drops every delta while `streamingMessage` is null, so without that seed the phone showed nothing mid-run and then the whole answer at once. `limit` lives in component state while the SSE effect depends on `sessionId` only (it calls `refreshRef.current()`), so paging back through history never re-subscribes the event stream; loading earlier records `{scrollHeight, scrollTop, messageCount}` and restores that anchor once the window actually grows, so the reader stays where they were.
- Not implemented yet: the desktop window does not adopt a run that the phone started while the desktop sits on the same session (its SSE is closed during the idle grace window). Doing so means touching `useAgentSession`'s adoption path.

### LAN access is a desktop-shell reverse proxy, not a wider bind
- The Next server always listens on loopback. `src-tauri/src/lan_proxy.rs` runs a small proxy on `0.0.0.0` at a **random free port** (port 0, skipping the upstream's own port) that authenticates HTTP Basic with username `pi`, then rewrites `Host`/`Origin`/`Referer` to the loopback upstream and forces `Connection: close`, forwarding byte-for-byte — so SSE and compressed responses work, and the loopback window stays password-free.
- Two traps in that byte-level forwarding, both now covered by tests:
  - The rewritten head must end with exactly **one** `\r\n\r\n`. `split("\r\n")` yields an extra empty tail, so the terminator loop must `break` on the first empty line; an extra CRLF makes the upstream wait for another request and answer nothing at all (`tests::terminates_the_head_exactly_once_and_forces_close`).
  - Upgrade requests (Next dev's HMR WebSocket) must keep `Connection: Upgrade` and be treated as a tunnel: force `Connection: close` and the handshake fails, and the client socket must drop its read timeout or an idle tunnel gets cut (`tests::keeps_the_upgrade_handshake_alive_for_websockets`).
  - **Never `shutdown(Shutdown::Write)` the upstream socket.** Sending FIN makes the Next dev server drop the connection without any response, which surfaces as `ERR_EMPTY_RESPONSE` in the browser while the proxy log still reports a successful forward. A GET is complete once its head is written, and a `Content-Length` POST once its body is written, so no half-close is needed; only chunked bodies stream on (`integration_tests::never_half_closes_the_upstream` asserts the upstream sees no FIN before responding).
- PWA metadata is served without credentials: browsers fetch `manifest.webmanifest` (and sometimes icons) with credentials omitted, so those paths bypass auth (`is_public_asset_request`). Everything else — the page, assets, APIs — still requires the password.
- `~/.pi/agent/desktop-access.log` is the proxy's own log (`peer`, `request`, `auth OK/FAILED`, upstream target, forwarded head with `Authorization` redacted, response byte count). It is the first place to look when the phone page is blank; the counters in `desktop-access.runtime.json` only tell you whether requests arrived.
- Config lives in `~/.pi/agent/desktop-access.json` (`enabled` + `password`); `lib/desktop-access.ts` is the Node-side reader/writer and `GET|PUT /api/mobile/access` is the settings page's only entry point. The manager thread re-reads the file every 400ms and the acceptor reads the current password per connection, so **changing the password never restarts anything** (this is the whole reason for the proxy instead of `--hostname 0.0.0.0`).
- The listening port is written to `~/.pi/agent/desktop-access.runtime.json` by the shell (together with `authSuccesses` / `authFailures` / `forwarded` / `lastPeer` counters, which are how you tell whether a phone request ever reached the proxy) and read back by `GET /api/mobile/pair`; the QR code must point at that port, not at the port the browser is using. Ports are random because the desktop shell's own server also picks one, so two fixed ranges would eventually collide. `lib/mobile-pair.ts` falls back to the CLI behaviour (`--hostname` + `PI_WEB_PASSWORD`) when the desktop config is off, which is what `npm run dev:lan` still uses.
- Tests: `cargo test --lib lan_proxy` covers the pure helpers plus two real integration tests (401 without credentials and nothing forwarded upstream; a password change taking effect without a restart).
- Pairing: the button next to the attachment control in `ChatInput` (hidden on mobile) opens `MobilePairDialog`, which asks `GET /api/mobile/pair`. `lib/mobile-pair.ts` resolves the address from `PI_WEB_HOSTNAME` — wildcard binds probe `os.networkInterfaces()` with private ranges first, CGNAT (Tailscale) next. A loopback-only server returns `url: null` so the dialog shows the `dev:lan` command instead of a QR code that cannot possibly work, and the payload never includes the password.

### Completion sound
- `hooks/useAudio.ts` stores the toggle in `localStorage` as `pi-sound-enabled` and reuses one `AudioContext`.
- Browser autoplay policy means sound must be unlocked from a user gesture; `ChatInput` calls the unlock hook from interactive controls, and `ChatWindow` plays the tone from `onAgentEnd`.

### Exported session HTML
- `/api/sessions/[id]/export` delegates to pi's export helper, then patches recursive tree helpers in the generated HTML to iterative versions so very deep linear sessions do not overflow the browser call stack.

## Pi Session File Format

Location: `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"zenmux","modelId":"claude-sonnet-4-6","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],...}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":N}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`entryIds[]` in `SessionContext` is a parallel array to `messages[]` — maps each displayed message back to its `.jsonl` entry id, used for fork and navigate_tree calls.

---

## CSS Variables (`app/globals.css`)

```
--bg --bg-panel --bg-hover --bg-selected --border
--text --text-muted --text-dim
--accent --user-bg --tool-bg
--font-mono
```

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
