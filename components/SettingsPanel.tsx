"use client";

import { useEffect, useState, type ReactNode } from "react";
import McpIcon from "@lobehub/icons/es/MCP/components/Mono";
import { Blocks, Cpu, Keyboard, Layers3, Settings2, Smartphone } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useChatAppearance } from "@/hooks/useChatAppearance";
import { sendAgentCommand } from "@/lib/agent-client";
import type { ShellToolSettingsResponse } from "@/lib/api-types";
import {
  CHAT_CONTENT_FONT_SIZE_DEFAULT,
  CHAT_CONTENT_FONT_SIZE_MAX,
  CHAT_CONTENT_FONT_SIZE_MIN,
  CHAT_CONTENT_WIDTH_DEFAULT,
  CHAT_CONTENT_WIDTH_MAX,
  CHAT_CONTENT_WIDTH_MIN,
} from "@/lib/chat-appearance";
import {
  isThinkingExpandedByDefault,
  setThinkingExpandedByDefault,
} from "@/lib/thinking-expansion-preference";
import { APPLICATION_VERSION, PI_VERSION } from "@/lib/changelog";
import { MCP_CATALOG, type McpCatalogEntry } from "@/lib/mcp-catalog";
import { KEYBOARD_SHORTCUT_GROUPS, KEYBOARD_SHORTCUTS } from "@/lib/keyboard-shortcuts";
import { ModelsConfig } from "./ModelsConfig";
import { MobileAccessSettings } from "./MobileAccessSettings";
import { PluginsConfig } from "./PluginsConfig";
import { SkillsConfig } from "./SkillsConfig";

type SettingsPanelProps = {
  cwd: string | null;
  hasProject: boolean;
  projectTrusted: boolean;
  sessionId: string | null;
  onClose: () => void;
  onModelsSaved: () => void;
  onMcpConfigured: () => void;
  onSessionReloaded: () => void;
  soundEnabled: boolean;
  onSoundToggle: () => void;
  bannerEnabled: boolean;
  onBannerToggle: () => void;
  themePreference: "light" | "dark" | "auto";
  onThemeChange?: (preference: "light" | "dark" | "auto") => void;
  locale: string;
  onLocaleChange?: (locale: string) => void;
  supportedLocales: { id: string; label: string }[];
};

type SettingsView = "menu" | "general" | "shortcuts" | "models" | "skills" | "plugins" | "mcp" | "mobile" | "mcp-editor";
type SettingsSection = Exclude<SettingsView, "menu" | "mcp-editor">;
type McpScope = "project" | "global";

type ThemeOption = "light" | "dark" | "auto";

const SETTINGS_ROW_ICON_STYLE = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: 30,
  flexShrink: 0,
  borderRadius: 7,
  background: "var(--bg-hover)",
  color: "var(--text-muted)",
} as const;

/** 一条设置项的骨架：左图标、中间标题与说明、右侧控件。 */
function SettingsRow({ icon, title, description, children }: {
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 10px", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
      <span style={SETTINGS_ROW_ICON_STYLE}>{icon}</span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{title}</span>
        <span style={{ display: "block", marginTop: 2, color: "var(--text-muted)", fontSize: 11, lineHeight: 1.45 }}>{description}</span>
      </span>
      {children}
    </div>
  );
}

/** 常规页的功能分组标题（外观 / 聊天 / Shell 工具）。 */
function SettingsGroupTitle({ children }: { children: ReactNode }) {
  return (
    <div style={{ margin: "16px 0 4px", padding: "0 10px", color: "var(--text-dim)", fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}>
      {children}
    </div>
  );
}

function SettingsSwitch({ checked, label, onChange, disabled }: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 38,
        height: 22,
        padding: 2,
        border: "none",
        borderRadius: 11,
        background: checked ? "var(--accent)" : "var(--border)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
        flexShrink: 0,
      }}
    >
      <span style={{ display: "block", width: 18, height: 18, borderRadius: "50%", background: "white", transform: checked ? "translateX(16px)" : "translateX(0)", transition: "transform 0.15s" }} />
    </button>
  );
}

type LanguageOption = {
  id: string;
  label: string;
};

function SettingsIcon({ name }: { name: SettingsSection }) {
  if (name === "general") return <Settings2 size={17} strokeWidth={1.8} aria-hidden="true" />;
  if (name === "shortcuts") return <Keyboard size={17} strokeWidth={1.8} aria-hidden="true" />;
  if (name === "models") return <Cpu size={17} strokeWidth={1.8} aria-hidden="true" />;
  if (name === "skills") return <Layers3 size={17} strokeWidth={1.8} aria-hidden="true" />;
  if (name === "plugins") return <Blocks size={17} strokeWidth={1.8} aria-hidden="true" />;
  if (name === "mobile") return <Smartphone size={17} strokeWidth={1.8} aria-hidden="true" />;
  return <McpIcon size={17} aria-hidden="true" />;
}

export function SettingsPanel({ cwd, hasProject, projectTrusted, sessionId, onClose, onModelsSaved, onMcpConfigured, onSessionReloaded, soundEnabled, onSoundToggle, bannerEnabled, onBannerToggle, themePreference, onThemeChange, locale, onLocaleChange, supportedLocales }: SettingsPanelProps) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [view, setView] = useState<SettingsView>("menu");
  const [visitedSections, setVisitedSections] = useState<Set<SettingsSection>>(() => new Set(["general"]));
  // 聊天阅读区（宽度/字号）：值存在浏览器里，写回后立即生效。
  const {
    width: chatContentWidth,
    setWidth: setChatContentWidth,
    fontSize: chatContentFontSize,
    setFontSize: setChatContentFontSize,
  } = useChatAppearance();
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [shellSettings, setShellSettings] = useState<ShellToolSettingsResponse | null>(null);
  const [shellSaving, setShellSaving] = useState(false);
  const [shellError, setShellError] = useState<string | null>(null);
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
      if (view === "mcp-editor") setView("mcp");
      else if (isMobile && view !== "menu") setView("menu");
      else onClose();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [isMobile, onClose, view]);

  useEffect(() => {
    setThinkingExpanded(isThinkingExpandedByDefault());
    void fetch("/api/tools/settings")
      .then(async (response) => {
        const data = await response.json() as ShellToolSettingsResponse & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        setShellSettings(data);
      })
      .catch((error) => setShellError(error instanceof Error ? error.message : String(error)));
  }, []);

  const togglePowerShell = async (enabled: boolean) => {
    setShellSaving(true);
    setShellError(null);
    try {
      const response = await fetch("/api/tools/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json() as ShellToolSettingsResponse & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setShellSettings(data);
      // 活跃工具集在会话创建时就定下来，因此保存后要重载当前会话，
      // 新选的 shell 工具才会真的出现在工具列表里。
      if (sessionId) {
        await sendAgentCommand(sessionId, { type: "reload" });
        onSessionReloaded();
      }
    } catch (error) {
      setShellError(error instanceof Error ? error.message : String(error));
    } finally {
      setShellSaving(false);
    }
  };

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

  const languageOptions: LanguageOption[] = (supportedLocales ?? []).map((plugin) => ({
    id: plugin.id,
    label: plugin.label,
  }));

  const renderThemeRow = () => (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 10px", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, flexShrink: 0, borderRadius: 7, background: "var(--bg-hover)", color: "var(--text-muted)" }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{t("settings.theme")}</span>
        <span style={{ display: "block", marginTop: 2, color: "var(--text-muted)", fontSize: 11, lineHeight: 1.45 }}>{t("settings.themeDescription")}</span>
      </span>
      <select
        value={themePreference}
        onChange={(event) => onThemeChange?.(event.target.value as ThemeOption)}
        aria-label={t("settings.theme")}
        style={{
          minHeight: 29, padding: "0 6px",
          border: "1px solid var(--border)", borderRadius: 6,
          background: "var(--bg-panel)", color: "var(--text)",
          fontSize: 11, cursor: "pointer", flexShrink: 0,
          maxWidth: 120,
        }}
      >
        <option value="light">{t("theme.light")}</option>
        <option value="dark">{t("theme.dark")}</option>
        <option value="auto">{t("theme.auto")}</option>
      </select>
    </div>
  );

  const renderLanguageRow = () => (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 10px", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, flexShrink: 0, borderRadius: 7, background: "var(--bg-hover)", color: "var(--text-muted)" }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m5 8 6 6" />
          <path d="m4 14 6-6 2-3" />
          <path d="M2 5h12" />
          <path d="M7 2h1" />
          <path d="m22 22-5-10-5 10" />
          <path d="M14 18h6" />
        </svg>
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{t("settings.language")}</span>
        <span style={{ display: "block", marginTop: 2, color: "var(--text-muted)", fontSize: 11, lineHeight: 1.45 }}>{t("settings.languageDescription")}</span>
      </span>
      <select
        value={locale}
        onChange={(event) => onLocaleChange?.(event.target.value)}
        aria-label={t("settings.language")}
        style={{
          minHeight: 29, padding: "0 6px",
          border: "1px solid var(--border)", borderRadius: 6,
          background: "var(--bg-panel)", color: "var(--text)",
          fontSize: 11, cursor: "pointer", flexShrink: 0,
          maxWidth: 160,
        }}
      >
        {languageOptions.map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
    </div>
  );

  // 版本信息行：只展示版本号，不可点。变更记录只从侧边栏标题的 ⓘ 弹窗进入，
  // 设置里不再叠一层对话框。
  const renderAboutRow = () => (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 10px", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, flexShrink: 0, borderRadius: 7, background: "var(--bg-hover)", color: "var(--text-muted)" }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <line x1="12" y1="11" x2="12" y2="16.5" />
          <circle cx="12" cy="7.8" r="0.7" fill="currentColor" stroke="none" />
        </svg>
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{t("settings.about")}</span>
        <span style={{ display: "block", marginTop: 2, color: "var(--text-muted)", fontSize: 11, lineHeight: 1.45, fontFamily: "var(--font-mono)" }}>
          {t("settings.aboutDescription", { version: APPLICATION_VERSION, piVersion: PI_VERSION })}
        </span>
      </span>
    </div>
  );

  // ── 聊天阅读区（pi-web 常规页的「聊天」分节） ──
  const renderThinkingRow = () => (
    <SettingsRow
      icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.7.78 3.21 2 4.21V14a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.29c1.22-1 2-2.51 2-4.21A5.5 5.5 0 0 0 9.5 2z" /><line x1="7" y1="18" x2="12" y2="18" /><line x1="8" y1="21" x2="11" y2="21" /></svg>}
      title={t("settings.thinkingExpandedDefault")}
      description={t("settings.thinkingExpandedDefaultDescription")}
    >
      <SettingsSwitch
        checked={thinkingExpanded}
        label={t("settings.thinkingExpandedDefault")}
        onChange={(enabled) => {
          // 先落盘再广播：已挂载的思考块靠这个事件原地开合，见 lib/thinking-expansion-preference.ts。
          setThinkingExpandedByDefault(enabled);
          setThinkingExpanded(enabled);
        }}
      />
    </SettingsRow>
  );

  /** 数值型设置行：标题与当前值在左侧，重置按钮与滑块在右侧。 */
  const renderRangeRow = (range: {
    id: string;
    icon: ReactNode;
    title: string;
    description: string;
    value: number;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
    resetLabel: string;
    onChange: (value: number) => void;
  }) => (
    <div style={{ padding: "11px 10px", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={SETTINGS_ROW_ICON_STYLE}>{range.icon}</span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <label htmlFor={range.id} style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{range.title}</label>
          <span style={{ display: "block", marginTop: 2, color: "var(--text-muted)", fontSize: 11, lineHeight: 1.45 }}>{range.description}</span>
        </span>
        <output htmlFor={range.id} style={{ flexShrink: 0, color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{range.value}px</output>
        <button
          type="button"
          disabled={range.value === range.defaultValue}
          onClick={() => range.onChange(range.defaultValue)}
          title={range.resetLabel}
          aria-label={range.resetLabel}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, flexShrink: 0, padding: 0, border: "none", borderRadius: 6, background: "none", color: range.value === range.defaultValue ? "var(--text-dim)" : "var(--text-muted)", cursor: range.value === range.defaultValue ? "default" : "pointer" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" /></svg>
        </button>
      </div>
      <input
        id={range.id}
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={range.value}
        onChange={(event) => range.onChange(Number(event.target.value))}
        style={{ display: "block", width: "100%", marginTop: 9, accentColor: "var(--accent)" }}
      />
    </div>
  );

  const renderChatWidthRow = () => renderRangeRow({
    id: "settings-chat-content-width",
    icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 7 3 12l5 5M16 7l5 5-5 5M3 12h18" /></svg>,
    title: t("settings.chatContentWidth"),
    description: t("settings.chatContentWidthDescription"),
    value: chatContentWidth,
    min: CHAT_CONTENT_WIDTH_MIN,
    max: CHAT_CONTENT_WIDTH_MAX,
    step: 10,
    defaultValue: CHAT_CONTENT_WIDTH_DEFAULT,
    resetLabel: t("settings.resetChatContentWidth"),
    onChange: setChatContentWidth,
  });

  const renderChatFontSizeRow = () => renderRangeRow({
    id: "settings-chat-content-font-size",
    icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 19l4-10 4 10M5.5 15.5h5M15 19l3-8 3 8M16 16.5h4" /></svg>,
    title: t("settings.chatContentFontSize"),
    description: t("settings.chatContentFontSizeDescription"),
    value: chatContentFontSize,
    min: CHAT_CONTENT_FONT_SIZE_MIN,
    max: CHAT_CONTENT_FONT_SIZE_MAX,
    step: 1,
    defaultValue: CHAT_CONTENT_FONT_SIZE_DEFAULT,
    resetLabel: t("settings.resetChatContentFontSize"),
    onChange: setChatContentFontSize,
  });

  // Windows 专用：无 Git Bash 的机器把 bash 槽换成 PowerShell 工具。
  const renderShellToolRow = () => (
    <SettingsRow
      icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5h16v14H4z" /><path d="m7 10 2.5 2.5L7 15M13 15h4" /></svg>}
      title={t("settings.usePowerShell")}
      description={t("settings.shellToolDescription")}
    >
      <SettingsSwitch
        checked={shellSettings?.powerShellEnabled === true}
        disabled={shellSaving || !shellSettings}
        label={t("settings.usePowerShell")}
        onChange={(enabled) => void togglePowerShell(enabled)}
      />
    </SettingsRow>
  );

  const visibleMcpServers = MCP_CATALOG.filter((preset) => {
    const query = mcpQuery.trim().toLocaleLowerCase();
    if (!query) return true;
    return [preset.name, preset.nameZh, preset.summary, preset.summaryZh].some((value) => value.toLocaleLowerCase().includes(query));
  });

  const visibleView: SettingsView = !isMobile && view === "menu" ? "general" : view;
  const activeSection: SettingsSection | null = visibleView === "menu"
    ? null
    : visibleView === "mcp-editor"
      ? "mcp"
      : visibleView;

  const navigateTo = (next: SettingsSection) => {
    if ((next === "skills" || next === "plugins") && !hasProject) return;
    setVisitedSections((current) => {
      if (current.has(next)) return current;
      const updated = new Set(current);
      updated.add(next);
      return updated;
    });
    setView(next);
  };

  // 顺序只由这里决定；「插件」刻意放在「快捷键」下方。
  const settingsItems = [
    { id: "general", label: t("settings.general"), description: t("settings.generalDescription"), disabled: false },
    { id: "shortcuts", label: t("settings.shortcuts"), description: t("settings.shortcutsDescription"), disabled: false },
    { id: "plugins", label: t("common.plugins"), description: t("settings.pluginsDescription"), disabled: !hasProject },
    { id: "models", label: t("common.models"), description: t("settings.modelsDescription"), disabled: false },
    { id: "skills", label: t("common.skills"), description: t("settings.skillsDescription"), disabled: !hasProject },
    { id: "mcp", label: t("settings.mcp"), description: t("settings.mcpDescription"), disabled: false },
    { id: "mobile", label: t("settings.mobile"), description: t("settings.mobileDescription"), disabled: false },
  ] satisfies Array<{ id: SettingsSection; label: string; description: string; disabled: boolean }>;

  return (
    <div
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        // 设置面板是全局最高层：必须压过关于对话框(1200)、SelectPicker(1201)、
        // Git 面板与各确认框(1100/1200)，否则聊天区里残留的下拉或面板会盖在它上面。
        position: "fixed", inset: 0, zIndex: 1300, display: "flex", alignItems: "center", justifyContent: "center",
        padding: isMobile ? 8 : 16, background: "rgba(0,0,0,0.32)",
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-panel-title"
        style={{
          width: isMobile ? "calc(100vw - 16px)" : "min(1080px, calc(100vw - 32px))",
          height: isMobile ? "calc(100dvh - 16px)" : "min(780px, calc(100dvh - 32px))",
          border: "1px solid var(--border)", borderRadius: isMobile ? 8 : 10,
          background: "var(--bg)", boxShadow: "0 14px 40px rgba(0,0,0,0.24)", overflow: "hidden",
          display: "flex", flexDirection: "column", position: "relative",
        }}
      >
        <header style={{ height: 48, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            {(view === "mcp-editor" || (isMobile && visibleView !== "menu")) && (
              <button
                type="button"
                onClick={() => setView(view === "mcp-editor" ? "mcp" : "menu")}
                title={t("settings.back")}
                aria-label={t("settings.back")}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, padding: 0, border: "none", borderRadius: 6, background: "none", color: "var(--text-muted)", cursor: "pointer", flexShrink: 0 }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
              </button>
            )}
            <span id="settings-panel-title" style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t("settings.title")}
            </span>
          </div>
          <button type="button" onClick={onClose} title={t("settings.close")} aria-label={t("settings.close")} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, padding: 0, border: "none", borderRadius: 6, background: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>
            ×
          </button>
        </header>

        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <aside
            style={{
              display: isMobile && visibleView !== "menu" ? "none" : "flex",
              width: isMobile ? "100%" : 184,
              padding: 8,
              borderRight: isMobile ? "none" : "1px solid var(--border)",
              background: "var(--bg-panel)",
              flexDirection: "column",
              flexShrink: 0,
            }}
          >
            <nav aria-label={t("settings.title")} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {settingsItems.map((item) => {
                const selected = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={item.disabled}
                    aria-current={selected ? "page" : undefined}
                    onClick={() => navigateTo(item.id)}
                    title={item.disabled ? t("settings.requiresProject") : item.label}
                    style={{
                      width: "100%", minHeight: isMobile ? 54 : 36, padding: isMobile ? "8px 10px" : "0 10px",
                      display: "flex", alignItems: "center", gap: 9, border: "none", borderRadius: 6,
                      background: selected ? "var(--bg-selected)" : "transparent",
                      color: item.disabled ? "var(--text-dim)" : selected ? "var(--text)" : "var(--text-muted)",
                      cursor: item.disabled ? "default" : "pointer", opacity: item.disabled ? 0.6 : 1, textAlign: "left",
                    }}
                    onMouseEnter={(event) => { if (!item.disabled && !selected) event.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={(event) => { if (!selected) event.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, flexShrink: 0 }}>
                      <SettingsIcon name={item.id} />
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "block", fontSize: 12, fontWeight: selected ? 650 : 500 }}>{item.label}</span>
                      {isMobile && <span style={{ display: "block", marginTop: 2, color: "var(--text-dim)", fontSize: 10, lineHeight: 1.35 }}>{item.disabled ? t("settings.requiresProject") : item.description}</span>}
                    </span>
                    {isMobile && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: "var(--text-dim)", flexShrink: 0 }}><path d="m9 18 6-6-6-6" /></svg>}
                  </button>
                );
              })}
            </nav>
          </aside>

          <main style={{ display: isMobile && visibleView === "menu" ? "none" : "block", flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden", position: "relative" }}>
            {visitedSections.has("general") && (
              <section hidden={activeSection !== "general"} aria-hidden={activeSection !== "general"} style={{ height: "100%", overflowY: "auto" }}>
                <div style={{ padding: "15px 18px 12px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ color: "var(--text)", fontSize: 15, fontWeight: 700 }}>{t("settings.general")}</div>
                  <div style={{ marginTop: 3, color: "var(--text-muted)", fontSize: 11 }}>{t("settings.generalDescription")}</div>
                </div>
                <div style={{ width: "min(720px, 100%)", padding: "8px 10px 18px" }}>
                  {renderThemeRow()}
                  {renderLanguageRow()}

                  <SettingsGroupTitle>{t("settings.groupChat")}</SettingsGroupTitle>
                  {renderThinkingRow()}
                  {renderChatWidthRow()}
                  {renderChatFontSizeRow()}
                  <SettingsRow
                    icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>}
                    title={t("settings.completionSound")}
                    description={t("settings.completionSoundDescription")}
                  >
                    <SettingsSwitch checked={soundEnabled} label={soundEnabled ? t("chat.disableSound") : t("chat.enableSound")} onChange={() => onSoundToggle()} />
                  </SettingsRow>
                  <SettingsRow
                    icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h16v12H4z" /><path d="M8 10h8" /><path d="M8 14h5" /></svg>}
                    title={t("settings.showBanner")}
                    description={t("settings.showBannerDescription")}
                  >
                    <SettingsSwitch checked={bannerEnabled} label={t("settings.showBanner")} onChange={() => onBannerToggle()} />
                  </SettingsRow>

                  {/* Shell 工具只在 Windows 存在；读取失败时也渲染这一节，
                      否则用户只能看到一个消失的开关而看不到原因。 */}
                  {(shellSettings?.isWindows === true || shellError !== null) && (
                    <>
                      <SettingsGroupTitle>{t("settings.shellTool")}</SettingsGroupTitle>
                      {renderShellToolRow()}
                      {shellError && <p role="alert" style={{ margin: "8px 10px 0", color: "var(--danger)", fontSize: 11, lineHeight: 1.45, overflowWrap: "anywhere" }}>{shellError}</p>}
                    </>
                  )}

                  {/* 「关于」固定在常规页最底部。 */}
                  {renderAboutRow()}
                </div>
              </section>
            )}

            {visitedSections.has("shortcuts") && (
              <section hidden={activeSection !== "shortcuts"} aria-hidden={activeSection !== "shortcuts"} style={{ height: "100%", overflowY: "auto" }}>
                <div style={{ padding: "15px 18px 12px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ color: "var(--text)", fontSize: 15, fontWeight: 700 }}>{t("settings.shortcuts")}</div>
                  <div style={{ marginTop: 3, color: "var(--text-muted)", fontSize: 11 }}>{t("settings.shortcutsDescription")}</div>
                </div>
                <div style={{ width: "min(760px, 100%)", padding: "8px 18px 24px" }}>
                  <div style={{ padding: "8px 0 2px", color: "var(--text-dim)", fontSize: 10, lineHeight: 1.45 }}>
                    {t("settings.shortcutsReadOnly")}
                  </div>
                  {KEYBOARD_SHORTCUT_GROUPS.map((group) => {
                    const shortcuts = KEYBOARD_SHORTCUTS.filter((shortcut) => shortcut.group === group.id);
                    return (
                      <div key={group.id} style={{ marginTop: 15 }}>
                        <div style={{ paddingBottom: 6, color: "var(--text-muted)", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>
                          {t(group.labelKey)}
                        </div>
                        <div style={{ borderTop: "1px solid var(--border)" }}>
                          {shortcuts.map((shortcut) => (
                            <div key={shortcut.id} style={{ minHeight: 47, padding: "8px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, borderBottom: "1px solid var(--border)" }}>
                              <span style={{ minWidth: 0, color: "var(--text)", fontSize: 12, lineHeight: 1.4 }}>
                                {t(shortcut.labelKey)}
                                {shortcut.noteKey && <span style={{ display: "block", marginTop: 2, color: "var(--text-dim)", fontSize: 10 }}>{t(shortcut.noteKey)}</span>}
                              </span>
                              <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, flexWrap: "wrap", flexShrink: 0 }}>
                                {shortcut.combos.map((combo, comboIndex) => (
                                  <span key={`${shortcut.id}-${comboIndex}`} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                                    {comboIndex > 0 && <span aria-hidden="true" style={{ marginRight: 2, color: "var(--text-dim)", fontSize: 10 }}>{t("settings.shortcutsOr")}</span>}
                                    {combo.map((key) => (
                                      <kbd key={key} style={{ minWidth: 24, height: 24, padding: "0 6px", display: "inline-flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border)", borderBottomWidth: 2, borderRadius: 5, background: "var(--bg-panel)", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 10, lineHeight: 1, whiteSpace: "nowrap" }}>
                                        {key}
                                      </kbd>
                                    ))}
                                  </span>
                                ))}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {visitedSections.has("models") && (
              <section hidden={activeSection !== "models"} aria-hidden={activeSection !== "models"} style={{ height: "100%" }}>
                <ModelsConfig embedded onSaved={onModelsSaved} />
              </section>
            )}
            {visitedSections.has("skills") && cwd && (
              <section hidden={activeSection !== "skills"} aria-hidden={activeSection !== "skills"} style={{ height: "100%" }}>
                <SkillsConfig cwd={cwd} embedded />
              </section>
            )}
            {visitedSections.has("plugins") && cwd && (
              <section hidden={activeSection !== "plugins"} aria-hidden={activeSection !== "plugins"} style={{ height: "100%" }}>
                <PluginsConfig cwd={cwd} sessionId={sessionId} embedded onReloaded={onSessionReloaded} />
              </section>
            )}

            {visitedSections.has("mcp") && (
              <section hidden={activeSection !== "mcp"} aria-hidden={activeSection !== "mcp"} style={{ height: "100%", overflowY: "auto" }}>
                <div style={{ padding: "15px 18px 12px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ color: "var(--text)", fontSize: 15, fontWeight: 700 }}>{view === "mcp-editor" ? t("settings.mcpEdit") : t("settings.mcp")}</div>
                  {view !== "mcp-editor" && <div style={{ marginTop: 3, color: "var(--text-muted)", fontSize: 11 }}>{t("settings.mcpDescription")}</div>}
                </div>
                {view === "mcp-editor" ? (
                  <div style={{ padding: "14px 18px 18px" }}>
                    <div style={{ color: "var(--text-muted)", fontSize: 11, lineHeight: 1.5, marginBottom: 9 }}>{t("settings.mcpEditorHint")}</div>
                    <textarea value={mcpEditorText} onChange={(event) => setMcpEditorText(event.target.value)} spellCheck={false} aria-label={t("settings.mcpEdit")} style={{ display: "block", width: "100%", minHeight: 330, resize: "vertical", padding: "10px 11px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.55, outline: "none" }} />
                    {mcpError && <div role="alert" style={{ marginTop: 9, color: "#dc2626", fontSize: 11, lineHeight: 1.45, overflowWrap: "anywhere" }}>{mcpError}</div>}
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 7, marginTop: 12 }}>
                      <button type="button" onClick={() => setView("mcp")} disabled={mcpEditorSaving} style={{ minHeight: 32, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, background: "none", color: "var(--text-muted)", cursor: mcpEditorSaving ? "default" : "pointer", fontSize: 11 }}>{t("settings.mcpCancel")}</button>
                      <button type="button" onClick={() => void saveMcpEditor()} disabled={mcpEditorSaving || (mcpScope === "project" && !projectTrusted)} style={{ minHeight: 32, padding: "0 11px", border: "1px solid var(--accent)", borderRadius: 6, background: "var(--accent)", color: "white", cursor: mcpEditorSaving || (mcpScope === "project" && !projectTrusted) ? "default" : "pointer", opacity: mcpEditorSaving || (mcpScope === "project" && !projectTrusted) ? 0.6 : 1, fontSize: 11 }}>{mcpEditorSaving ? t("settings.mcpSaving") : t("settings.mcpSave")}</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: "14px 18px 18px" }}>
                    <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.55 }}>{t("settings.mcpBody")}</p>
                    <div style={{ marginTop: 12, padding: "9px 11px", border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg-panel)", color: "var(--text-muted)", fontSize: 11, lineHeight: 1.6 }}>
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
                      <input value={mcpQuery} onChange={(event) => setMcpQuery(event.target.value)} placeholder={t("settings.mcpSearchPlaceholder")} aria-label={t("settings.mcpSearchPlaceholder")} style={{ width: "100%", height: 34, padding: "0 10px 0 29px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "var(--text)", fontSize: 12, outline: "none" }} />
                      <span aria-hidden="true" style={{ position: "absolute", left: 9, top: 0, bottom: 0, display: "flex", alignItems: "center", color: "var(--text-dim)", pointerEvents: "none" }}>
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="7" cy="7" r="4.5" /><line x1="10.6" y1="10.6" x2="14" y2="14" /></svg>
                      </span>
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
                    <button type="button" onClick={() => navigateTo("plugins")} disabled={!hasProject} style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 14, minHeight: 32, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-hover)", color: !hasProject ? "var(--text-dim)" : "var(--text)", cursor: !hasProject ? "default" : "pointer", fontSize: 11, opacity: !hasProject ? 0.62 : 1 }}>
                      <SettingsIcon name="plugins" />
                      {t("settings.mcpBrowsePlugins")}
                    </button>
                  </div>
                )}
              </section>
            )}

            {visitedSections.has("mobile") && (
              <section hidden={activeSection !== "mobile"} aria-hidden={activeSection !== "mobile"} style={{ height: "100%", overflowY: "auto" }}>
                <div style={{ padding: "15px 18px 12px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ color: "var(--text)", fontSize: 15, fontWeight: 700 }}>{t("settings.mobile")}</div>
                  <div style={{ marginTop: 3, color: "var(--text-muted)", fontSize: 11 }}>{t("settings.mobileDescription")}</div>
                </div>
                <div style={{ padding: "14px 18px 18px" }}>
                  <MobileAccessSettings />
                </div>
              </section>
            )}
          </main>
        </div>
      </section>
    </div>
  );
}
