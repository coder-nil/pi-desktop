"use client";

import { useEffect } from "react";

// ---------------------------------------------------------------------------
// Module-level registry — ChatWindow registers the abort handler here so that
// the global Esc listener in AppShell can call it without prop-drilling.
// ---------------------------------------------------------------------------
let globalAbortHandler: (() => void) | null = null;

/**
 * Register (or clear) the abort handler for the global Esc shortcut.
 * Call this from ChatWindow whenever agentRunning or handleAbort changes.
 */
export function registerAbortHandler(handler: (() => void) | null): void {
  globalAbortHandler = handler;
}

// ---------------------------------------------------------------------------
// Hook: global keyboard shortcuts
// ---------------------------------------------------------------------------

interface UseGlobalKeyboardShortcutsOptions {
  /** Called when Ctrl/Cmd+N is pressed. Receives current cwd. */
  onNewSession?: (cwd: string) => void;
  /** Called when Ctrl/Cmd+B is pressed to show the sidebar. */
  onShowSidebar?: () => void;
  /** Called when Ctrl/Cmd+` is pressed to toggle the console. */
  onToggleConsole?: () => void;
  /** Called when Ctrl/Cmd+O is pressed to open the directory picker. */
  onOpenDirectory?: () => void;
  /** The currently selected project directory (sidebar cwd). */
  activeCwd?: string | null;
}

/**
 * Register global keyboard shortcuts for the application.
 *
 * Shortcuts handled here:
 *   Esc          – stop the running agent (via module-level abort handler)
 *   Ctrl/Cmd+N   – create a new session in the active project directory
 *   Ctrl/Cmd+B   – show the sidebar
 *   Ctrl/Cmd+`   – toggle the console
 *
 * Note: Esc inside <textarea> or <input> is deliberately NOT handled here.
 * ChatInput manages its own Esc logic (closing slash / @ file menus, stopping
 * the agent when no menu is open) because it needs intimate knowledge of menu
 * state that is local to that component.
 */
export function useGlobalKeyboardShortcuts(
  options: UseGlobalKeyboardShortcutsOptions,
): void {
  const { onNewSession, onShowSidebar, onToggleConsole, onOpenDirectory, activeCwd } = options;

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // ---- Esc: stop agent ----
      if (e.key === "Escape") {
        if (!globalAbortHandler) return;

        const tag = (e.target as HTMLElement)?.tagName;
        // Let textarea/input handle Esc internally (ChatInput menus / stop).
        if (tag === "TEXTAREA" || tag === "INPUT") return;

        e.preventDefault();
        globalAbortHandler();
        return;
      }

      // ---- Ctrl/Cmd+N: new session ----
      if (e.key.toLowerCase() === "n" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        if (!activeCwd || !onNewSession) return;
        e.preventDefault();
        onNewSession(activeCwd);
        return;
      }

      // ---- Ctrl/Cmd+B: show sidebar ----
      if ((e.code === "KeyB" || e.key.toLowerCase() === "b") && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        if (!onShowSidebar) return;
        e.preventDefault();
        onShowSidebar();
        return;
      }

      // ---- Ctrl/Cmd+`: toggle console ----
      if ((e.code === "Backquote" || e.key === "`") && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        if (!onToggleConsole) return;
        e.preventDefault();
        onToggleConsole();
        return;
      }

      // ---- Ctrl/Cmd+O: open directory picker ----
      if ((e.code === "KeyO" || e.key.toLowerCase() === "o") && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        if (!onOpenDirectory) return;
        e.preventDefault();
        onOpenDirectory();
      }
    };

    // Capture before editor/input handlers can stop propagation of browser-level shortcuts.
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [activeCwd, onNewSession, onShowSidebar, onToggleConsole, onOpenDirectory]);
}
