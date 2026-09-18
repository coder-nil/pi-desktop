"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useViewportHeight } from "@/hooks/useViewportHeight";
import { INITIAL_STREAMING_STATE, streamReducer } from "@/lib/streaming-message";
import { projectAssistantBlocks, type MobileMessage } from "@/lib/mobile-state";

/**
 * 手机遥控页：同一份会话数据的精简视图。
 *
 * 数据流：
 *   1. `GET /api/mobile/state` 取一次快照（消息已在服务端压成纯文本）；
 *   2. `GET /api/agent/[id]/events` SSE 推送流式进度，只用于渲染「正在输出」的尾巴；
 *   3. prompt / abort / 新建任务分别复用桌面端的 `POST /api/agent/[id]` 与
 *      `POST /api/agent/new`，不新增写接口。
 */

interface MobileStateSnapshot {
  sessionId: string | null;
  name: string | null;
  cwd: string | null;
  status: "running" | "idle";
  updatedAt: string | null;
  queue: { steering: number; followUp: number };
  messages: MobileMessage[];
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function readParams(): { session: string | null; cwd: string | null } {
  if (typeof window === "undefined") return { session: null, cwd: null };
  const params = new URLSearchParams(window.location.search);
  return { session: params.get("session"), cwd: params.get("cwd") };
}

export function MobileRemoteView() {
  const { t } = useI18n();
  useViewportHeight();

  // URL 是唯一真相：读出参数之前不发任何请求，否则会用「服务端挑中的会话」覆盖扫码指定的会话。
  const [target, setTarget] = useState<{ session: string | null; cwd: string | null } | null>(null);
  const [snapshot, setSnapshot] = useState<MobileStateSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [streaming, dispatch] = useReducer(streamReducer, INITIAL_STREAMING_STATE);
  const scrollRef = useRef<HTMLDivElement>(null);
  const startedAtRef = useRef<number | null>(null);

  // 扫码进入时 URL 里带 session / cwd。
  useEffect(() => {
    setTarget(readParams());
  }, []);

  const refresh = useCallback(async () => {
    if (!target) return;
    try {
      const query = new URLSearchParams({ limit: "30" });
      if (target.session) query.set("session", target.session);
      if (target.cwd) query.set("cwd", target.cwd);
      const response = await fetch(`/api/mobile/state?${query.toString()}`);
      const data = await response.json() as MobileStateSnapshot & { error?: string };
      if (!response.ok || data.error) {
        setError(data.error ?? `HTTP ${response.status}`);
        return;
      }
      setError(null);
      setSnapshot(data);
      // 只有 URL 没指定会话时，才接管服务端挑中的那一个。
      if (!target.session && data.sessionId) {
        const next = { session: data.sessionId, cwd: target.cwd ?? data.cwd };
        setTarget(next);
        window.history.replaceState(null, "", `/m?session=${encodeURIComponent(data.sessionId)}${next.cwd ? `&cwd=${encodeURIComponent(next.cwd)}` : ""}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [target]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 运行计时：从第一帧流式标记开始算。
  const running = snapshot?.status === "running" || streaming.isStreaming;
  useEffect(() => {
    if (!running) {
      startedAtRef.current = null;
      setElapsed(0);
      return;
    }
    if (startedAtRef.current === null) startedAtRef.current = Date.now() - elapsed * 1000;
    const timer = window.setInterval(() => {
      const startedAt = startedAtRef.current;
      if (startedAt !== null) setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
    // elapsed 只用于首帧补算，不参与依赖，避免每秒重建定时器。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // SSE：流式尾巴 + 终态后补一次快照。切到后台就断开，回到前台先补快照再重连。
  const sessionId = target?.session ?? null;
  useEffect(() => {
    if (!sessionId) return;
    let source: EventSource | null = null;
    let closed = false;

    const connect = () => {
      if (closed || source) return;
      source = new EventSource(`/api/agent/${encodeURIComponent(sessionId)}/events`);
      source.onmessage = (event) => {
        let payload: { type?: string; assistantMessageEvent?: unknown };
        try {
          payload = JSON.parse(event.data) as typeof payload;
        } catch {
          return;
        }
        if (payload.type === "agent_start") {
          dispatch({ type: "start" });
          return;
        }
        if (payload.type === "message_update" && payload.assistantMessageEvent) {
          dispatch({ type: "delta", event: payload.assistantMessageEvent as never });
          return;
        }
        if (payload.type === "prompt_done" || payload.type === "agent_settled") {
          dispatch({ type: "end" });
          void refresh();
        }
      };
      // EventSource 自己会重连；这里只在隐藏页面时主动断开，省电。
      source.onerror = () => {};
    };

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        source?.close();
        source = null;
        return;
      }
      void refresh();
      connect();
    };

    connect();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      closed = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      source?.close();
      source = null;
    };
  }, [sessionId, refresh]);

  const messages = useMemo(() => snapshot?.messages ?? [], [snapshot]);

  const liveTail = useMemo(() => {
    const message = streaming.streamingMessage;
    if (!message) return null;
    const { text, tools } = projectAssistantBlocks((message as { content?: unknown }).content);
    if (!text && tools.length === 0) return null;
    return { text, tools };
  }, [streaming.streamingMessage]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, liveTail?.text]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (sessionId) {
        const response = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "prompt", message: text }),
        });
        const data = await response.json() as { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      } else {
        const targetCwd = target?.cwd ?? snapshot?.cwd ?? null;
        if (!targetCwd) throw new Error(t("mobile.needProject"));
        const response = await fetch("/api/agent/new", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd: targetCwd, type: "prompt", message: text }),
        });
        const data = await response.json() as { sessionId?: string; error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (data.sessionId) {
          setTarget({ session: data.sessionId, cwd: targetCwd });
          window.history.replaceState(null, "", `/m?session=${encodeURIComponent(data.sessionId)}&cwd=${encodeURIComponent(targetCwd)}`);
        }
      }
      setInput("");
      dispatch({ type: "start" });
      startedAtRef.current = Date.now();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [busy, input, sessionId, snapshot?.cwd, t, target?.cwd]);

  const stop = useCallback(async () => {
    if (!sessionId) return;
    try {
      await fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "abort" }),
      });
      dispatch({ type: "end" });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [refresh, sessionId]);

  // 新建任务：脱离当前会话，下一次发送会在这个项目里开一个新会话。
  const startNewTask = useCallback(() => {
    const targetCwd = snapshot?.cwd ?? target?.cwd ?? null;
    setTarget({ session: null, cwd: targetCwd });
    setSnapshot(null);
    dispatch({ type: "end" });
    window.history.replaceState(null, "", targetCwd ? `/m?cwd=${encodeURIComponent(targetCwd)}` : "/m");
  }, [snapshot?.cwd, target?.cwd]);

  const statusLabel = running ? t("mobile.statusRunning") : t("mobile.statusIdle");
  const statusColor = running ? "#4ade80" : "var(--text-dim)";
  const queued = (snapshot?.queue.steering ?? 0) + (snapshot?.queue.followUp ?? 0);
  const cwdLabel = snapshot?.cwd ?? target?.cwd ?? "";

  return (
    <div
      style={{
        height: "var(--app-viewport-height, 100dvh)",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
        color: "var(--text)",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <header style={{ flexShrink: 0, padding: "12px 14px 10px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor, flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: statusColor }}>
              {statusLabel}{running ? ` ${formatElapsed(elapsed)}` : ""}
            </span>
            {queued > 0 && (
              <span style={{ fontSize: 10, color: "var(--text-dim)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 5px" }}>
                {t("mobile.queued", { count: queued })}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => void stop()}
            disabled={!running}
            style={{
              flexShrink: 0, padding: "5px 12px", borderRadius: 6,
              border: "1px solid var(--border)", background: "none",
              color: running ? "var(--text)" : "var(--text-dim)",
              cursor: running ? "pointer" : "default", fontSize: 12,
            }}
          >
            {t("mobile.stop")}
          </button>
        </div>
        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
            {snapshot?.name ?? (sessionId ? sessionId.slice(0, 8) : t("mobile.newTask"))}
          </span>
          {cwdLabel && (
            <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "left" }}>
              {cwdLabel}
            </span>
          )}
        </div>
      </header>

      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
        {messages.map((message) => (
          <div key={message.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
              {message.role === "user" ? t("mobile.you") : t("mobile.assistant")}
              {message.at ? ` · ${message.at}` : ""}
            </span>
            {message.tools?.map((tool, index) => (
              <span key={`${message.id}-tool-${index}`} style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                ▸ {tool}
              </span>
            ))}
            {message.text && (
              <p style={{
                margin: 0, fontSize: 13, lineHeight: 1.65, whiteSpace: "pre-wrap", overflowWrap: "anywhere",
                color: message.role === "user" ? "var(--text)" : "var(--text-muted)",
              }}>
                {message.text}
              </p>
            )}
          </div>
        ))}

        {liveTail && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{t("mobile.assistant")}</span>
            {liveTail.tools.map((tool, index) => (
              <span key={`live-tool-${index}`} style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                ▸ {tool}
              </span>
            ))}
            {liveTail.text && (
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.65, whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "var(--text-muted)" }}>
                {liveTail.text}
                <span style={{ display: "inline-block", width: 7, height: 14, marginLeft: 3, verticalAlign: "-2px", background: "var(--accent)", animation: "blink 1s ease-in-out infinite" }} />
              </p>
            )}
          </div>
        )}

        {!snapshot && !error && (
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("settings.mobileLoading")}</span>
        )}
        {snapshot && messages.length === 0 && !liveTail && (
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("mobile.emptySession")}</span>
        )}
      </div>

      {error && (
        <div role="alert" style={{ flexShrink: 0, padding: "8px 14px", color: "#f87171", fontSize: 11, lineHeight: 1.5, overflowWrap: "anywhere", borderTop: "1px solid var(--border)" }}>
          {error}
        </div>
      )}

      <div style={{ flexShrink: 0, padding: "10px 14px 12px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <textarea
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              const element = event.currentTarget;
              element.style.height = "auto";
              element.style.height = `${Math.min(element.scrollHeight, 108)}px`;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder={running ? t("mobile.placeholderQueued") : t("mobile.placeholder")}
            aria-label={t("mobile.placeholder")}
            style={{
              flex: 1, minWidth: 0, resize: "none", maxHeight: 108,
              padding: "9px 11px", borderRadius: 8, fontSize: 16, lineHeight: 1.5,
              background: "var(--bg-panel)", border: "1px solid var(--border)",
              color: "var(--text)", outline: "none", fontFamily: "inherit",
            }}
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!input.trim() || busy}
            style={{
              flexShrink: 0, height: 38, padding: "0 14px", borderRadius: 8, border: "none",
              background: input.trim() && !busy ? "var(--accent)" : "var(--bg-panel)",
              color: input.trim() && !busy ? "#fff" : "var(--text-dim)",
              cursor: input.trim() && !busy ? "pointer" : "default", fontSize: 13, fontWeight: 600,
            }}
          >
            {t("mobile.send")}
          </button>
        </div>
        <button
          type="button"
          onClick={startNewTask}
          style={{
            alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 5,
            padding: "4px 0", border: "none", background: "none",
            color: "var(--text-muted)", cursor: "pointer", fontSize: 11,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {t("mobile.newTask")}
          {cwdLabel && (
            <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>
              {cwdLabel}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
