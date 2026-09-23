import type { FileViewerState } from "@/lib/file-viewer-state";
import type { Tab } from "./TabBar";

interface OpenFileTabInput {
  fileName: string;
  filePath: string;
  modeHint?: "diff";
  /** 1-based line the link pointed at, revealed once by the viewer. */
  line?: number;
  sourceSessionId?: string | null;
  tabId: string;
}

export function openFileTab(tabs: Tab[], input: OpenFileTabInput): Tab[] {
  const existing = tabs.find((tab) => tab.id === input.tabId);
  if (!existing) {
    return [...tabs, {
      id: input.tabId,
      label: input.fileName,
      filePath: input.filePath,
      kind: "file",
      sourceSessionId: input.sourceSessionId,
      initialDisplayMode: input.modeHint,
      revealLine: input.line,
      viewerState: input.modeHint ? {
        displayMode: input.modeHint,
        wrapLines: false,
        scrollTop: 0,
        scrollLeft: 0,
      } : undefined,
      viewerRevision: 0,
    }];
  }

  const sourceChanged = Boolean(
    input.sourceSessionId && existing.sourceSessionId !== input.sourceSessionId,
  );
  const wantsReveal = input.line !== undefined;
  if (!sourceChanged && !input.modeHint && !wantsReveal) return tabs;

  return tabs.map((tab) => {
    if (tab.id !== input.tabId) return tab;
    const next: Tab = { ...tab };
    if (sourceChanged) next.sourceSessionId = input.sourceSessionId;
    if (input.modeHint) {
      next.initialDisplayMode = input.modeHint;
      next.viewerState = {
        displayMode: input.modeHint,
        wrapLines: tab.viewerState?.wrapLines ?? false,
        scrollTop: 0,
        scrollLeft: 0,
      };
    }
    if (wantsReveal) next.revealLine = input.line;
    // 定位要用新的初始行重挂载一次；单纯换数据源或切换模式也要重建。
    if (sourceChanged || input.modeHint || wantsReveal) {
      next.viewerRevision = (tab.viewerRevision ?? 0) + 1;
    }
    return next;
  });
}

/** 查看器已经跳到目标行，丢掉待跳标记，这样切走再切回来不会重复跳。 */
export function markFileTabRevealHandled(tabs: Tab[], tabId: string): Tab[] {
  const index = tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1 || tabs[index].revealLine === undefined) return tabs;
  const next = [...tabs];
  const tab = { ...next[index] };
  delete tab.revealLine;
  next[index] = tab;
  return next;
}

export function saveFileViewerState(
  tabs: Tab[],
  tabId: string,
  viewerRevision: number,
  viewerState: FileViewerState,
): Tab[] {
  const index = tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1 || (tabs[index].viewerRevision ?? 0) !== viewerRevision) return tabs;

  const currentState = tabs[index].viewerState;
  if (
    currentState?.displayMode === viewerState.displayMode &&
    currentState.wrapLines === viewerState.wrapLines &&
    currentState.scrollTop === viewerState.scrollTop &&
    currentState.scrollLeft === viewerState.scrollLeft
  ) {
    return tabs;
  }

  const next = [...tabs];
  next[index] = { ...next[index], viewerState };
  return next;
}
