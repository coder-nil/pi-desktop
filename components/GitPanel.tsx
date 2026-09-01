"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { BranchPicker } from "./BranchPicker";

// MergeBranchPicker delegates to the shared picker, which renders the accessible
// role="combobox" / role="listbox" control and uses git.selectBranch as its fallback label.

type GitFileStatus = {
  filePath: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflict";
  code: string;
  indexStatus: string;
  worktreeStatus: string;
};

type GitSummary = {
  isGitRepository: boolean;
  repositoryRoot: string | null;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  remote: string | null;
  credentialKind: "https" | "ssh" | "none";
  hasSavedCredential: boolean;
  operation: "merge" | "rebase" | "cherry-pick" | "revert" | null;
  branches: string[];
  changes: { files: GitFileStatus[]; additions: number; deletions: number };
};

type Action = "stage" | "unstage" | "discard" | "commit" | "fetch" | "pull" | "push" | "merge" | "continue" | "abort" | "summarize";

const STATUS_COLOR: Record<GitFileStatus["status"], string> = {
  modified: "#d6a84b", added: "#4ade80", deleted: "#f87171", renamed: "#60a5fa", untracked: "#4ade80", conflict: "#f87171",
};

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

export function GitPanel({ cwd, sessionId, onClose, onChanged }: { cwd: string; sessionId: string | null; onClose: () => void; onChanged: () => void }) {
  const { locale, t } = useI18n();
  const [summary, setSummary] = useState<GitSummary | null>(null);
  const [message, setMessage] = useState("");
  const [mergeBranch, setMergeBranch] = useState("");
  const [pullRebase, setPullRebase] = useState(false);
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [rememberCredential, setRememberCredential] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/git?${new URLSearchParams({ cwd }).toString()}`);
    const data = await res.json() as GitSummary & { error?: string };
    if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
    setSummary(data);
  }, [cwd]);

  useEffect(() => { void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))); }, [refresh]);

  const run = useCallback(async (action: Action, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    setError(null);
    try {
      const isRemoteAction = action === "fetch" || action === "pull" || action === "push";
      const credentialKind = summary?.credentialKind;
      const credential = isRemoteAction && secret && (credentialKind === "https" || credentialKind === "ssh")
        ? { kind: credentialKind, secret, ...(credentialKind === "https" ? { username } : {}) }
        : undefined;
      const res = await fetch("/api/git", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, action, ...extra, ...(credential ? { credential, rememberCredential } : {}) }) });
      const data = await res.json() as GitSummary & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSummary(data);
      if (action === "commit") setMessage("");
      if (action === "merge") setMergeBranch("");
      if (isRemoteAction && secret) setSecret("");
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      void refresh().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }, [cwd, onChanged, refresh, rememberCredential, secret, summary?.credentialKind, username]);

  const summarizeCommitMessage = useCallback(async () => {
    setBusy("summarize");
    setError(null);
    try {
      const res = await fetch("/api/git/commit-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, locale, ...(sessionId ? { sessionId } : {}) }),
      });
      const data = await res.json() as { message?: string; error?: string };
      if (!res.ok || data.error || !data.message) throw new Error(data.error ?? `HTTP ${res.status}`);
      setMessage(data.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }, [cwd, locale, sessionId]);

  const staged = summary?.changes.files.filter((file) => file.indexStatus !== " " && file.indexStatus !== "?") ?? [];
  const unstaged = summary?.changes.files.filter((file) => file.worktreeStatus !== " " || file.indexStatus === "?") ?? [];
  const conflictCount = summary?.changes.files.filter((file) => file.status === "conflict").length ?? 0;
  const mergeBranches = summary?.branches.filter((branch) => branch !== summary.branch) ?? [];
  const disabled = busy !== null;
  const needsHttpsCredential = summary?.credentialKind === "https";
  const needsSshCredential = summary?.credentialKind === "ssh";

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !disabled) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [disabled, onClose]);

  return (
    <div role="presentation" onClick={(event) => { if (!disabled && event.currentTarget === event.target) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 1100, display: "flex", justifyContent: "flex-end", background: "rgba(0,0,0,.34)" }}>
      <section role="dialog" aria-modal="true" aria-label={t("common.git")} style={{ width: 460, maxWidth: "100vw", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)", borderLeft: "1px solid var(--border)", boxShadow: "-14px 0 32px rgba(0,0,0,.16)" }}>
        <header style={{ height: 52, padding: "0 14px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><path d="M6 9v6a3 3 0 0 0 3 3h6" /><path d="M18 15V9a3 3 0 0 0-3-3H9" /></svg>
          <strong style={{ fontSize: 14 }}>{t("common.git")}</strong>
          <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{summary?.repositoryRoot ?? cwd}</span>
          <button type="button" onClick={() => void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))} disabled={disabled} title={t("git.refreshStatus")} aria-label={t("git.refreshStatus")} style={iconButtonStyle} onMouseEnter={(event) => { if (!disabled) event.currentTarget.style.background = "var(--bg-hover)"; }} onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}><span aria-hidden="true">↻</span></button>
          <button type="button" onClick={onClose} disabled={disabled} title={t("git.close")} aria-label={t("git.close")} style={iconButtonStyle} onMouseEnter={(event) => { if (!disabled) event.currentTarget.style.background = "var(--bg-hover)"; }} onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}><span aria-hidden="true">×</span></button>
        </header>
        <main style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 14 }}>
          {error && <div role="alert" style={{ marginBottom: 12, padding: "8px 10px", border: "1px solid rgba(248,113,113,.45)", background: "rgba(248,113,113,.08)", color: "#ef4444", fontSize: 12, lineHeight: 1.45, overflowWrap: "anywhere" }}>{error}</div>}
          {!summary && !error && <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("git.loadingRepository")}</div>}
          {summary && !summary.isGitRepository && <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("git.notRepository")}</div>}
          {summary?.isGitRepository && <>
            <div style={summaryStyle}>
              <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{t("git.branch")}</span><strong style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{summary.branch ?? t("git.detachedHead")}</strong>
              <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{t("git.sync")}</span><span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{summary.upstream ? `↑${summary.ahead} ↓${summary.behind}` : t("git.noUpstream")}</span>
            </div>
            {summary.operation && <div style={{ marginTop: 10, padding: "9px 10px", border: "1px solid rgba(214,168,75,.5)", background: "rgba(214,168,75,.10)", color: "var(--text)", fontSize: 12 }}>{t("git.operationInProgress", { operation: t(`git.operation.${summary.operation}`) })}{conflictCount ? ` ${t("git.operationConflicts", { count: conflictCount })}` : ""}<div style={{ display: "flex", gap: 6, marginTop: 8 }}><ActionButton label={t("git.continue")} busy={busy} action="continue" onClick={() => void run("continue")} /><ActionButton label={t("git.abort")} busy={busy} action="abort" danger onClick={() => void run("abort")} /></div></div>}
            <div style={sectionStyle}><SectionTitle title={t("git.changesSummary", { additions: summary.changes.additions, deletions: summary.changes.deletions })} /><FileList files={unstaged} empty={t("git.noUnstagedChanges")} busy={busy} onStage={(filePath) => void run("stage", { paths: [filePath] })} onDiscard={(file) => { if (file.status !== "untracked" && window.confirm(t("git.discardFileConfirm", { file: fileName(file.filePath) }))) void run("discard", { paths: [file.filePath] }); }} /></div>
            <div style={sectionStyle}><SectionTitle title={t("git.stagedSummary", { count: staged.length })} /><FileList files={staged} empty={t("git.nothingStaged")} busy={busy} onUnstage={(filePath) => void run("unstage", { paths: [filePath] })} /></div>
            <div style={sectionStyle}><SectionTitle title={t("git.commit")} /><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder={t("git.commitMessage")} disabled={disabled} rows={7} style={{ width: "100%", resize: "vertical", padding: 8, border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text)", fontFamily: "inherit", fontSize: 12, lineHeight: 1.5 }} /><div style={{ marginTop: 7, display: "flex", justifyContent: "flex-end", gap: 6 }}><ActionButton label={t("git.summarizeCommit")} action="summarize" busy={busy} disabled={staged.length === 0 || conflictCount > 0} title={t("git.summarizeCommitTitle")} onClick={() => void summarizeCommitMessage()} /><ActionButton label={t("git.commitStaged")} action="commit" busy={busy} disabled={!message.trim() || staged.length === 0 || conflictCount > 0} onClick={() => void run("commit", { message })} /></div></div>
            <div style={sectionStyle}>
              <SectionTitle title={t("git.remote")} />
              {summary.remote && <div style={{ marginBottom: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11, overflowWrap: "anywhere" }}>{summary.remote}</div>}
              {(needsHttpsCredential || needsSshCredential) && <div style={{ display: "grid", gap: 7, marginBottom: 10, padding: 10, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)" }}>
                <div style={{ color: "var(--text-muted)", fontSize: 11 }}>{t(needsHttpsCredential ? "git.httpsCredentials" : "git.sshCredentials")}{summary.hasSavedCredential ? ` · ${t("git.savedCredential")}` : ""}</div>
                {needsHttpsCredential && <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder={t("git.username")} autoComplete="username" disabled={disabled} style={credentialInputStyle} />}
                <input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder={t(needsHttpsCredential ? "git.passwordOrToken" : "git.keyPassphrase")} autoComplete="current-password" disabled={disabled} style={credentialInputStyle} />
                <label style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--text-muted)", fontSize: 11 }}><input type="checkbox" checked={rememberCredential} onChange={(event) => setRememberCredential(event.target.checked)} disabled={disabled} /> {t("git.rememberCredential")}</label>
              </div>}
              {summary.credentialKind === "none" && summary.remote?.startsWith("git://") && <div style={{ marginBottom: 10, color: "var(--text-muted)", fontSize: 11 }}>{t("git.nativeProtocolAnonymous")}</div>}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><ActionButton label={t("git.fetch")} action="fetch" busy={busy} onClick={() => void run("fetch")} /><ActionButton label={t(pullRebase ? "git.pullRebase" : "git.pullMerge")} action="pull" busy={busy} onClick={() => void run("pull", { rebase: pullRebase })} /><ActionButton label={t("git.push")} action="push" busy={busy} onClick={() => void run("push")} /><label style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--text-muted)", fontSize: 11 }}><input type="checkbox" checked={pullRebase} onChange={(event) => setPullRebase(event.target.checked)} disabled={disabled} /> {t("git.rebaseWhenPulling")}</label></div>
            </div>
            <div style={sectionStyle}><SectionTitle title={t("git.mergeBranch")} /><div style={{ display: "flex", gap: 6 }}><MergeBranchPicker branches={mergeBranches} value={mergeBranch} disabled={disabled} onChange={setMergeBranch} /><ActionButton label={t("git.merge")} action="merge" busy={busy} disabled={!mergeBranch || mergeBranches.length === 0} onClick={() => void run("merge", { branch: mergeBranch })} /></div></div>
          </>}
        </main>
      </section>
    </div>
  );
}

const iconButtonStyle: CSSProperties = { width: 28, height: 28, padding: 0, border: "none", borderRadius: 5, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 18, lineHeight: 1, transition: "background .12s, color .12s" };
const sectionStyle: CSSProperties = { marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border)" };
const summaryStyle: CSSProperties = { display: "grid", gridTemplateColumns: "58px minmax(0, 1fr)", rowGap: 7, alignItems: "center", padding: "10px", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 6 };
const credentialInputStyle: CSSProperties = { width: "100%", boxSizing: "border-box", minHeight: 30, padding: "5px 7px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text)", fontFamily: "inherit", fontSize: 12 };
function SectionTitle({ title }: { title: string }) { return <div style={{ marginBottom: 8, color: "var(--text-muted)", fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase" }}>{title}</div>; }
function ActionButton({ label, action, busy, disabled, danger, title, onClick }: { label: string; action: Action; busy: Action | null; disabled?: boolean; danger?: boolean; title?: string; onClick: () => void }) { const { t } = useI18n(); const pending = busy === action; const inactive = Boolean(busy) || disabled; const hoverBackground = danger ? "rgba(248,113,113,.12)" : "var(--bg-hover)"; return <button type="button" title={title} onClick={onClick} disabled={inactive} onMouseEnter={(event) => { if (!inactive) event.currentTarget.style.background = hoverBackground; }} onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }} style={{ height: 30, padding: "0 10px", border: "none", borderRadius: 5, background: "transparent", color: danger ? "#ef4444" : "var(--text)", cursor: inactive ? "not-allowed" : "pointer", opacity: inactive ? .58 : 1, fontSize: 11, fontWeight: 600, transition: "background .12s" }}>{pending ? t("git.working") : label}</button>; }
function FileList({ files, empty, busy, onStage, onUnstage, onDiscard }: { files: GitFileStatus[]; empty: string; busy: Action | null; onStage?: (filePath: string) => void; onUnstage?: (filePath: string) => void; onDiscard?: (file: GitFileStatus) => void }) { const { t } = useI18n(); if (!files.length) return <div style={{ color: "var(--text-dim)", fontSize: 12 }}>{empty}</div>; return <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>{files.map((file) => <div key={`${file.filePath}:${file.indexStatus}:${file.worktreeStatus}`} style={{ minHeight: 35, padding: "5px 7px", display: "flex", alignItems: "center", gap: 7, borderBottom: "1px solid var(--border)" }}><span style={{ width: 14, color: STATUS_COLOR[file.status], fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700 }}>{file.code}</span><span title={file.filePath} style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)", fontSize: 11 }}>{fileName(file.filePath)}</span>{onStage && <ActionButton label={t("git.stage")} action="stage" busy={busy} onClick={() => onStage(file.filePath)} />}{onUnstage && <ActionButton label={t("git.unstage")} action="unstage" busy={busy} onClick={() => onUnstage(file.filePath)} />}{onDiscard && file.status !== "untracked" && <ActionButton label={t("git.discard")} action="discard" busy={busy} danger onClick={() => onDiscard(file)} />}</div>)}</div>; }

function MergeBranchPicker({ branches, value, disabled, onChange }: { branches: string[]; value: string; disabled: boolean; onChange: (branch: string) => void }) {
  return <BranchPicker branches={branches} value={value} disabled={disabled} placement="above" onChange={onChange} />;
}
