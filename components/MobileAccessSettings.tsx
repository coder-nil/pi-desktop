"use client";

import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";

type AccessState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | {
      phase: "ready";
      enabled: boolean;
      password: string | null;
      lanPort: number | null;
      minPasswordLength: number;
      desktopShell: boolean;
    };

/**
 * 设置 → 手机访问。
 *
 * 这里只负责把开关与密码写进配置文件；真正对局域网监听和做认证的是桌面壳里的
 * 反向代理，它会热加载这份配置，所以改密码不需要重启任何东西，也不会打断正在
 * 运行的任务。
 */
export function MobileAccessSettings() {
  const { t } = useI18n();
  const [state, setState] = useState<AccessState>({ phase: "loading" });
  const [lanUrl, setLanUrl] = useState<string | null>(null);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [accessResponse, pairResponse] = await Promise.all([
        fetch("/api/mobile/access"),
        fetch("/api/mobile/pair"),
      ]);
      const data = await accessResponse.json() as {
        enabled?: boolean;
        password?: string | null;
        lanPort?: number | null;
        minPasswordLength?: number;
        desktopShell?: boolean;
        error?: string;
      };
      const pair = await pairResponse.json() as { url?: string | null };
      setLanUrl(pair.url ?? null);
      if (!accessResponse.ok || data.error) {
        setState({ phase: "error", message: data.error ?? `HTTP ${accessResponse.status}` });
        return;
      }
      setState({
        phase: "ready",
        enabled: data.enabled ?? false,
        password: data.password ?? null,
        lanPort: data.lanPort ?? null,
        minPasswordLength: data.minPasswordLength ?? 8,
        desktopShell: data.desktopShell ?? false,
      });
      setPasswordDraft(data.password ?? "");
    } catch (error) {
      setState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 代理收到新配置到真正监听之间有一个很短的窗口，轮询一次把端口补上。
  useEffect(() => {
    if (state.phase !== "ready" || !state.enabled || state.lanPort !== null) return;
    const timer = window.setTimeout(() => { void load(); }, 1200);
    return () => window.clearTimeout(timer);
  }, [state, load]);

  const save = useCallback(async (enabled: boolean) => {
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/mobile/access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, password: passwordDraft }),
      });
      const data = await response.json() as {
        enabled?: boolean;
        password?: string | null;
        lanPort?: number | null;
        minPasswordLength?: number;
        desktopShell?: boolean;
        error?: string;
        code?: string;
      };
      if (!response.ok || data.error) {
        setNotice({
          kind: "error",
          text: data.code === "password-required"
            ? t("settings.mobilePasswordRequired")
            : data.code === "too-short"
              ? t("settings.mobilePasswordTooShort", { count: state.phase === "ready" ? state.minPasswordLength : 8 })
              : (data.error ?? `HTTP ${response.status}`),
        });
        return;
      }
      setState({
        phase: "ready",
        enabled: data.enabled ?? false,
        password: data.password ?? null,
        lanPort: data.lanPort ?? null,
        minPasswordLength: data.minPasswordLength ?? 8,
        desktopShell: data.desktopShell ?? (state.phase === "ready" ? state.desktopShell : true),
      });
      setPasswordDraft(data.password ?? "");
      setNotice({ kind: "ok", text: t("settings.mobileSaved") });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  }, [passwordDraft, state, t]);

  if (state.phase === "loading") {
    return <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("settings.mobileLoading")}</div>;
  }
  if (state.phase === "error") {
    return <div style={{ color: "#f87171", fontSize: 12, overflowWrap: "anywhere" }}>{state.message}</div>;
  }

  const passwordTooShort = passwordDraft.trim().length > 0
    && passwordDraft.trim().length < state.minPasswordLength;
  const canEnable = passwordDraft.trim().length >= state.minPasswordLength;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 620 }}>
      <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6 }}>
        {t("settings.mobileBody")}
      </p>

      {!state.desktopShell && (
        <div style={{ padding: "9px 11px", border: "1px solid rgba(245,158,11,.35)", borderRadius: 7, color: "var(--text-muted)", fontSize: 11, lineHeight: 1.6 }}>
          {t("settings.mobileCliOnly")}
        </div>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={state.enabled}
          disabled={saving || (!state.enabled && !canEnable)}
          onChange={(event) => void save(event.target.checked)}
          style={{ margin: 0, accentColor: "var(--accent)" }}
        />
        <span style={{ fontSize: 12, color: "var(--text)" }}>{t("settings.mobileEnable")}</span>
        {!state.enabled && !canEnable && (
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("settings.mobilePasswordFirst")}</span>
        )}
      </label>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("settings.mobilePassword")}</span>
        <div style={{ display: "flex", gap: 6 }}>
          <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
            <input
              type={showPassword ? "text" : "password"}
              value={passwordDraft}
              onChange={(event) => setPasswordDraft(event.target.value)}
              placeholder={t("settings.mobilePasswordPlaceholder", { count: state.minPasswordLength })}
              autoComplete="new-password"
              spellCheck={false}
              style={{
                width: "100%", height: 34, padding: "0 34px 0 10px",
                border: "1px solid var(--border)", borderRadius: 6,
                background: "var(--bg-panel)", color: "var(--text)",
                fontSize: 12, fontFamily: "var(--font-mono)", outline: "none",
              }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? t("i18n.hideDetails") : t("i18n.showDetails")}
              style={{ position: "absolute", right: 5, top: "50%", transform: "translateY(-50%)", width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", padding: 0, border: "none", background: "none", color: "var(--text-dim)", cursor: "pointer" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {showPassword
                  ? <><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C7 20 2.73 16.89 1 12a18.45 18.45 0 0 1 5.06-6.94" /><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c5 0 9.27 3.11 11 8a18.5 18.5 0 0 1-2.16 3.19" /><path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" /><path d="M1 1l22 22" /></>
                  : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z" /><circle cx="12" cy="12" r="3" /></>}
              </svg>
            </button>
          </div>
          <button
            type="button"
            onClick={() => void save(state.enabled)}
            disabled={saving || passwordTooShort}
            style={{
              flexShrink: 0, height: 34, padding: "0 12px", border: "none", borderRadius: 6,
              background: saving || passwordTooShort ? "var(--bg-panel)" : "var(--accent)",
              color: saving || passwordTooShort ? "var(--text-dim)" : "#fff",
              cursor: saving || passwordTooShort ? "default" : "pointer",
              fontSize: 12, fontWeight: 600,
            }}
          >
            {saving ? t("i18n.saving") : t("i18n.save")}
          </button>
        </div>
        <span style={{ fontSize: 10, color: passwordTooShort ? "#f87171" : "var(--text-dim)" }}>
          {t("settings.mobilePasswordHint", { count: state.minPasswordLength })}
        </span>
      </div>

      {notice && <span style={{ fontSize: 11, color: notice.kind === "ok" ? "#16a34a" : "#f87171" }}>{notice.text}</span>}

      {state.enabled && (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {state.lanPort === null || !lanUrl ? (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("settings.mobileStarting")}</span>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 5, padding: "6px 8px", overflowWrap: "anywhere" }}>
                  {lanUrl}
                </code>
                <button
                  type="button"
                  onClick={() => { void copyText(lanUrl); }}
                  style={{ padding: "5px 10px", border: "1px solid var(--border)", borderRadius: 5, background: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}
                >
                  {t("mobile.pairCopy")}
                </button>
              </div>
              <div style={{ alignSelf: "flex-start", padding: 10, borderRadius: 8, background: "#fff" }}>
                <QRCodeSVG value={lanUrl} size={148} level="M" marginSize={0} />
              </div>
              <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
                {t("settings.mobileScanHint")}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
