"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { MCP_CATALOG, type McpCatalogEntry } from "@/lib/mcp-catalog";

type SettingsPanelProps = {
  cwd: string | null;
  hasProject: boolean;
  projectTrusted: boolean;
  onClose: () => void;
  onOpenModels: () => void;
  onOpenSkills: () => void;
  onOpenPlugins: () => void;
  onMcpConfigured: () => void;
};

type SettingsView = "menu" | "mcp" | "mcp-editor";
type McpScope = "project" | "global";

function SettingsIcon({ name }: { name: "models" | "skills" | "plugins" | "mcp" }) {
  if (name === "models") {
    return (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" />
        <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
        <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
        <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
        <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
      </svg>
    );
  }
  if (name === "skills") {
    return (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 2 2 7l10 5 10-5-10-5Z" /><path d="m2 17 10 5 10-5" /><path d="m2 12 10 5 10-5" />
      </svg>
    );
  }
  if (name === "plugins") {
    return (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 7V2" /><path d="M15 7V2" /><path d="M6 13V8a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v5a6 6 0 0 1-12 0Z" /><path d="M12 19v3" />
      </svg>
    );
  }
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v3" /><path d="M12 18v3" /><path d="m4.22 4.22 2.12 2.12" /><path d="m17.66 17.66 2.12 2.12" />
      <path d="M3 12h3" /><path d="M18 12h3" /><path d="m4.22 19.78 2.12-2.12" /><path d="m17.66 6.34 2.12-2.12" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

export function SettingsPanel({ cwd, hasProject, projectTrusted, onClose, onOpenModels, onOpenSkills, onOpenPlugins, onMcpConfigured }: SettingsPanelProps) {
  const { t } = useI18n();
  const [view, setView] = useState<SettingsView>("menu");
  const [mcpQuery, setMcpQuery] = useState("");
  const [mcpServers, setMcpServers] = useState<Set<string>>(() => new Set());
  const [mcpBusy, setMcpBusy] = useState<string | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpNotice, setMcpNotice] = useState<string | null>(null);
  const [adapterReady, setAdapterReady] = useState(false);
  const [mcpTesting, setMcpTesting] = useState<string | null>(null);
  const [mcpTestResults, setMcpTestResults] = useState<Record<string, { status: string; message: string }>>({});
  const [mcpEditorText, setMcpEditorText] = useState("");
  const [mcpEditorLoading, setMcpEditorLoading] = useState(false);
  const [mcpEditorSaving, setMcpEditorSaving] = useState(false);
  const [mcpScope, setMcpScope] = useState<McpScope>("project");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (view !== "menu") setView("menu");
      else onClose();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose, view]);

  useEffect(() => {
    if (view !== "mcp" || !cwd) return;
    const controller = new AbortController();
    Promise.all([
      fetch(`/api/mcp?cwd=${encodeURIComponent(cwd)}&scope=${mcpScope}`, { signal: controller.signal }),
      fetch(`/api/plugins?cwd=${encodeURIComponent(cwd)}`, { signal: controller.signal }),
    ])
      .then(async ([mcpResponse, pluginsResponse]) => {
        const mcpData = await mcpResponse.json() as { servers?: unknown; error?: string };
        if (!mcpResponse.ok || mcpData.error) throw new Error(mcpData.error ?? `HTTP ${mcpResponse.status}`);
        if (Array.isArray(mcpData.servers)) setMcpServers(new Set(mcpData.servers.filter((server): server is string => typeof server === "string")));
        const pluginsData = await pluginsResponse.json() as { packages?: Array<{ source?: unknown; packageName?: unknown }> };
        if (pluginsResponse.ok && Array.isArray(pluginsData.packages)) {
          setAdapterReady(pluginsData.packages.some((pkg) => pkg.packageName === "pi-mcp-adapter" || pkg.source === "npm:pi-mcp-adapter"));
        }
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setMcpError(error instanceof Error ? error.message : String(error));
      });
    return () => controller.abort();
  }, [cwd, mcpScope, view]);

  const handleUseMcpServer = async (preset: McpCatalogEntry) => {
    if (!cwd || (mcpScope === "project" && !projectTrusted) || mcpBusy) return;
    setMcpBusy(preset.id);
    setMcpError(null);
    setMcpNotice(null);
    try {
      if (!adapterReady) {
        const adapterResponse = await fetch("/api/plugins", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "install", source: "npm:pi-mcp-adapter", scope: "global", cwd }),
        });
        const adapterData = await adapterResponse.json() as { error?: string };
        if (!adapterResponse.ok || adapterData.error) throw new Error(adapterData.error ?? `HTTP ${adapterResponse.status}`);
        setAdapterReady(true);
      }
      const response = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, presetId: preset.id, scope: mcpScope }),
      });
      const data = await response.json() as { error?: string; servers?: unknown[]; added?: boolean };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      if (Array.isArray(data.servers)) setMcpServers(new Set(data.servers.filter((server): server is string => typeof server === "string")));
      setMcpNotice(data.added === false ? t("settings.mcpAlreadyAdded") : t("settings.mcpAdded", { name: preset.name }));
      onMcpConfigured();
    } catch (error) {
      setMcpError(error instanceof Error ? error.message : String(error));
    } finally {
      setMcpBusy(null);
    }
  };

  const handleTestMcpServer = async (preset: McpCatalogEntry) => {
    if (!cwd || !projectTrusted || mcpTesting) return;
    setMcpTesting(preset.id);
    setMcpError(null);
    try {
      const response = await fetch("/api/mcp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, presetId: preset.id }),
      });
      const data = await response.json() as { status?: string; message?: string; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      const status = data.status ?? "failed";
      const messageKey = status === "passed"
        ? "settings.mcpTestPassedResult"
        : status === "auth-required"
          ? "settings.mcpTestAuthResult"
          : status === "configured"
            ? "settings.mcpTestConfiguredResult"
            : status === "unknown"
              ? "settings.mcpTestUnknownResult"
              : "settings.mcpTestFailedResult";
      setMcpTestResults((current) => ({ ...current, [preset.id]: { status, message: t(messageKey, { name: preset.name, detail: data.message ?? "" }) } }));
    } catch (error) {
      setMcpTestResults((current) => ({ ...current, [preset.id]: { status: "failed", message: t("settings.mcpTestFailedResult", { name: preset.name, detail: error instanceof Error ? error.message : String(error) }) } }));
    } finally {
      setMcpTesting(null);
    }
  };

  const openMcpEditor = async () => {
    if (!cwd || (mcpScope === "project" && !projectTrusted) || mcpEditorLoading) return;
    setMcpEditorLoading(true);
    setMcpError(null);
    try {
      const response = await fetch(`/api/mcp?cwd=${encodeURIComponent(cwd)}&scope=${mcpScope}&includeContent=1`);
      const data = await response.json() as { content?: string; error?: string };
      if (!response.ok || typeof data.content !== "string") throw new Error(data.error ?? `HTTP ${response.status}`);
      setMcpEditorText(data.content);
      setView("mcp-editor");
    } catch (error) {
      setMcpError(error instanceof Error ? error.message : String(error));
    } finally {
      setMcpEditorLoading(false);
    }
  };

  const saveMcpEditor = async () => {
    if (!cwd || (mcpScope === "project" && !projectTrusted) || mcpEditorSaving) return;
    setMcpEditorSaving(true);
    setMcpError(null);
    try {
      const response = await fetch("/api/mcp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, scope: mcpScope, content: mcpEditorText }),
      });
      const data = await response.json() as { servers?: unknown; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      if (Array.isArray(data.servers)) setMcpServers(new Set(data.servers.filter((server): server is string => typeof server === "string")));
      setMcpNotice(t("settings.mcpSaved"));
      onMcpConfigured();
      setView("mcp");
    } catch (error) {
      setMcpError(error instanceof Error ? error.message : String(error));
    } finally {
      setMcpEditorSaving(false);
    }
  };

  const visibleMcpServers = MCP_CATALOG.filter((preset) => {
    const query = mcpQuery.trim().toLocaleLowerCase();
    if (!query) return true;
    return [preset.name, preset.nameZh, preset.summary, preset.summaryZh].some((value) => value.toLocaleLowerCase().includes(query));
  });

  const openExistingConfig = (open: () => void) => {
    onClose();
    open();
  };

  return (
    <div
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: "fixed", inset: 0, zIndex: 1050, display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16, background: "rgba(0,0,0,0.32)",
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-panel-title"
        style={{
          width: 420, maxWidth: "100%", border: "1px solid var(--border)", borderRadius: 10,
          background: "var(--bg-panel)", boxShadow: "0 14px 40px rgba(0,0,0,0.24)", overflow: "hidden",
        }}
      >
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 17px 13px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            {view !== "menu" && (
              <button type="button" onClick={() => setView(view === "mcp-editor" ? "mcp" : "menu")} title={t("settings.back")} aria-label={t("settings.back")} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, padding: 0, border: "none", borderRadius: 6, background: "none", color: "var(--text-muted)", cursor: "pointer" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
              </button>
            )}
            <span id="settings-panel-title" style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
              {view === "mcp-editor" ? t("settings.mcpEdit") : view === "mcp" ? t("settings.mcp") : t("settings.title")}
            </span>
          </div>
          <button type="button" onClick={onClose} title={t("settings.close")} aria-label={t("settings.close")} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, padding: 0, border: "none", borderRadius: 6, background: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>
            ×
          </button>
        </header>

        {view === "menu" ? (
          <div style={{ padding: 8 }}>
            {([
              ["models", t("common.models"), t("settings.modelsDescription"), onOpenModels, false],
              ["skills", t("common.skills"), t("settings.skillsDescription"), onOpenSkills, !hasProject],
              ["plugins", t("common.plugins"), t("settings.pluginsDescription"), onOpenPlugins, !hasProject],
            ] as const).map(([id, label, description, onOpen, disabled]) => (
              <button
                key={id}
                type="button"
                disabled={disabled}
                onClick={() => openExistingConfig(onOpen)}
                style={{
                  display: "flex", width: "100%", alignItems: "center", gap: 12, padding: "11px 10px", border: "none", borderRadius: 7,
                  background: "none", color: disabled ? "var(--text-dim)" : "var(--text)", textAlign: "left", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.62 : 1,
                }}
                onMouseEnter={(event) => { if (!disabled) event.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(event) => { event.currentTarget.style.background = "none"; }}
              >
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, flexShrink: 0, borderRadius: 7, background: "var(--bg-hover)", color: "var(--text-muted)" }}>
                  <SettingsIcon name={id} />
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{label}</span>
                  <span style={{ display: "block", marginTop: 2, color: "var(--text-muted)", fontSize: 11, lineHeight: 1.45 }}>{disabled ? t("settings.requiresProject") : description}</span>
                </span>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: "var(--text-dim)", flexShrink: 0 }}><path d="m9 18 6-6-6-6" /></svg>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setView("mcp")}
              style={{ display: "flex", width: "100%", alignItems: "center", gap: 12, padding: "11px 10px", border: "none", borderRadius: 7, background: "none", color: "var(--text)", textAlign: "left", cursor: "pointer" }}
              onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(event) => { event.currentTarget.style.background = "none"; }}
            >
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, flexShrink: 0, borderRadius: 7, background: "var(--bg-hover)", color: "var(--text-muted)" }}><SettingsIcon name="mcp" /></span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{t("settings.mcp")}</span>
                <span style={{ display: "block", marginTop: 2, color: "var(--text-muted)", fontSize: 11, lineHeight: 1.45 }}>{t("settings.mcpDescription")}</span>
              </span>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: "var(--text-dim)", flexShrink: 0 }}><path d="m9 18 6-6-6-6" /></svg>
            </button>
          </div>
        ) : view === "mcp" ? (
          <div style={{ padding: "14px 16px 16px", maxHeight: "min(600px, calc(100dvh - 120px))", overflowY: "auto" }}>
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.55 }}>{t("settings.mcpBody")}</p>
            <div style={{ marginTop: 12, padding: "9px 11px", border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg)", color: "var(--text-muted)", fontSize: 11, lineHeight: 1.6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                <div style={{ color: "var(--text)", fontWeight: 600 }}>{t("settings.mcpConfigFiles")}</div>
                <div role="group" aria-label={t("settings.mcpConfigFiles")} style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
                  {(["project", "global"] as const).map((scope) => (
                    <button key={scope} type="button" onClick={() => setMcpScope(scope)} style={{ minHeight: 27, padding: "0 8px", border: "none", borderRight: scope === "project" ? "1px solid var(--border)" : "none", background: mcpScope === scope ? "var(--bg-selected)" : "transparent", color: mcpScope === scope ? "var(--text)" : "var(--text-muted)", cursor: "pointer", fontSize: 10 }}>
                      {scope === "project" ? t("settings.mcpProject") : t("settings.mcpGlobal")}
                    </button>
                  ))}
                </div>
              </div>
              <code style={{ display: "block", fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>{mcpScope === "project" ? ".mcp.json" : "~/.pi/agent/mcp.json"}</code>
              <button type="button" onClick={() => void openMcpEditor()} disabled={!hasProject || (mcpScope === "project" && !projectTrusted) || mcpEditorLoading} title={t("settings.mcpEdit")} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, minHeight: 29, padding: "0 8px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-hover)", color: !hasProject || (mcpScope === "project" && !projectTrusted) ? "var(--text-dim)" : "var(--text)", cursor: !hasProject || (mcpScope === "project" && !projectTrusted) || mcpEditorLoading ? "default" : "pointer", opacity: !hasProject || (mcpScope === "project" && !projectTrusted) ? 0.62 : 1, fontSize: 11 }}>
                {mcpEditorLoading ? t("settings.mcpLoading") : t("settings.mcpEdit")}
              </button>
            </div>
            <div style={{ position: "relative", marginTop: 14 }}>
              <input value={mcpQuery} onChange={(event) => setMcpQuery(event.target.value)} placeholder={t("settings.mcpSearchPlaceholder")} aria-label={t("settings.mcpSearchPlaceholder")} style={{ width: "100%", height: 34, padding: "0 10px 0 30px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "var(--text)", fontSize: 12, outline: "none" }} />
              <span aria-hidden="true" style={{ position: "absolute", left: 10, top: 7, color: "var(--text-dim)", fontSize: 15 }}>⌕</span>
            </div>
            {mcpNotice && <div role="status" style={{ marginTop: 10, color: "#16a34a", fontSize: 11 }}>{mcpNotice}</div>}
            {mcpError && <div role="alert" style={{ marginTop: 10, color: "#dc2626", fontSize: 11, lineHeight: 1.5, overflowWrap: "anywhere" }}>{mcpError}</div>}
            {!hasProject ? (
              <div style={{ marginTop: 14, padding: "10px 11px", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text-muted)", fontSize: 11 }}>{t("settings.requiresProject")}</div>
            ) : !projectTrusted ? (
              <div style={{ marginTop: 14, padding: "10px 11px", border: "1px solid rgba(245,158,11,.35)", borderRadius: 7, color: "var(--text-muted)", fontSize: 11 }}>{t("settings.mcpTrustRequired")}</div>
            ) : null}
            <div style={{ display: "flex", flexDirection: "column", marginTop: 12, borderTop: "1px solid var(--border)" }}>
              {visibleMcpServers.map((preset) => {
                const added = mcpServers.has(preset.id);
                const busy = mcpBusy === preset.id;
                const title = t("settings.mcpUse");
                return (
                  <div key={preset.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 0" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                        <strong style={{ color: "var(--text)", fontSize: 12 }}>{t("settings.mcpName", { en: preset.name, zh: preset.nameZh })}</strong>
                        {preset.auth === "oauth" && <span style={{ padding: "2px 5px", borderRadius: 4, background: "rgba(59,130,246,.12)", color: "#2563eb", fontSize: 10 }}>{t("settings.mcpOAuth")}</span>}
                      </div>
                      <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 11, lineHeight: 1.45 }}>{t("settings.mcpSummary", { en: preset.summary, zh: preset.summaryZh })}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flexShrink: 0 }}>
                      <div style={{ display: "flex", gap: 5 }}>
                        {added && <button type="button" onClick={() => void openMcpEditor()} title={t("settings.mcpEdit")} aria-label={t("settings.mcpEdit")} style={{ minHeight: 29, padding: "0 7px", border: "1px solid var(--border)", borderRadius: 6, background: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}>{mcpEditorLoading ? t("settings.mcpLoading") : t("settings.mcpEdit")}</button>}
                        {added && <button type="button" disabled={!projectTrusted || Boolean(mcpTesting)} onClick={() => void handleTestMcpServer(preset)} title={t("settings.mcpTest")} aria-label={t("settings.mcpTest")} style={{ minHeight: 29, padding: "0 7px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-hover)", color: !projectTrusted ? "var(--text-dim)" : "var(--text)", cursor: !projectTrusted || mcpTesting ? "default" : "pointer", opacity: !projectTrusted ? 0.58 : 1, fontSize: 11 }}>{mcpTesting === preset.id ? t("settings.mcpTesting") : t("settings.mcpTest")}</button>}
                        {!added && <button type="button" disabled={!hasProject || (mcpScope === "project" && !projectTrusted) || Boolean(mcpBusy)} onClick={() => void handleUseMcpServer(preset)} title={title} style={{ minWidth: 70, minHeight: 29, padding: "0 8px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-hover)", color: "var(--text)", cursor: !hasProject || (mcpScope === "project" && !projectTrusted) || mcpBusy ? "default" : "pointer", opacity: !hasProject || (mcpScope === "project" && !projectTrusted) ? 0.58 : 1, fontSize: 11 }}>{busy ? t("settings.mcpAdding") : title}</button>}
                      </div>
                      {added && <span style={{ color: "var(--text-dim)", fontSize: 10 }}>{t("settings.mcpAddedState")}</span>}
                    </div>
                    </div>
                    {mcpTestResults[preset.id] && <div style={{ margin: "-3px 0 10px", color: mcpTestResults[preset.id].status === "passed" || mcpTestResults[preset.id].status === "configured" ? "#16a34a" : mcpTestResults[preset.id].status === "auth-required" ? "#2563eb" : "#dc2626", fontSize: 10, lineHeight: 1.45 }}>{mcpTestResults[preset.id].message}</div>}
                  </div>
                );
              })}
            </div>
            {visibleMcpServers.length === 0 && <div style={{ padding: "18px 2px", color: "var(--text-dim)", fontSize: 11 }}>{t("settings.mcpNoMatches")}</div>}
            <button type="button" onClick={() => openExistingConfig(onOpenPlugins)} disabled={!hasProject} style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 14, minHeight: 32, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-hover)", color: !hasProject ? "var(--text-dim)" : "var(--text)", cursor: !hasProject ? "default" : "pointer", fontSize: 11, opacity: !hasProject ? 0.62 : 1 }}>
              <SettingsIcon name="plugins" />
              {t("settings.mcpBrowsePlugins")}
            </button>
          </div>
        ) : (
          <div style={{ padding: "14px 16px 16px" }}>
            <div style={{ color: "var(--text-muted)", fontSize: 11, lineHeight: 1.5, marginBottom: 9 }}>{t("settings.mcpEditorHint")}</div>
            <textarea value={mcpEditorText} onChange={(event) => setMcpEditorText(event.target.value)} spellCheck={false} aria-label={t("settings.mcpEdit")} style={{ display: "block", width: "100%", minHeight: 330, resize: "vertical", padding: "10px 11px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.55, outline: "none" }} />
            {mcpError && <div role="alert" style={{ marginTop: 9, color: "#dc2626", fontSize: 11, lineHeight: 1.45, overflowWrap: "anywhere" }}>{mcpError}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 7, marginTop: 12 }}>
              <button type="button" onClick={() => setView("mcp")} disabled={mcpEditorSaving} style={{ minHeight: 32, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, background: "none", color: "var(--text-muted)", cursor: mcpEditorSaving ? "default" : "pointer", fontSize: 11 }}>{t("settings.mcpCancel")}</button>
              <button type="button" onClick={() => void saveMcpEditor()} disabled={mcpEditorSaving || (mcpScope === "project" && !projectTrusted)} style={{ minHeight: 32, padding: "0 11px", border: "1px solid var(--accent)", borderRadius: 6, background: "var(--accent)", color: "white", cursor: mcpEditorSaving || (mcpScope === "project" && !projectTrusted) ? "default" : "pointer", opacity: mcpEditorSaving || (mcpScope === "project" && !projectTrusted) ? 0.6 : 1, fontSize: 11 }}>{mcpEditorSaving ? t("settings.mcpSaving") : t("settings.mcpSave")}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
