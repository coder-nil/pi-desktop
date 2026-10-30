export type FileViewerDisplayMode = "edit" | "source" | "preview" | "diff";

export interface FileViewerState {
  displayMode: FileViewerDisplayMode;
  wrapLines: boolean;
  scrollTop: number;
  scrollLeft: number;
}

export function resolveInitialFileDisplayMode(
  initialState?: FileViewerState,
  initialDisplayMode?: FileViewerDisplayMode,
): FileViewerDisplayMode {
  return initialState?.displayMode ?? initialDisplayMode ?? "source";
}

/**
 * 没有保存过的标签状态、也没有显式模式提示时，这个文件应该以哪个模式打开。
 *
 * 语言要等文件内容回来才知道，所以调用方先传 `language: undefined` 拿一个临时结果
 * （只能区分「可编辑 → edit」与「source」），内容到达后用真实语言重算一次。
 *
 * - markdown 永远先给渲染后的预览：打开 md 基本是来读的，要改就点 Edit。
 * - html 只在不可编辑时预览（可编辑时给它编辑器）。
 * - 带行号打开（`path:12` 链接）的走源码视图，预览里没法定位行。
 */
export function defaultOpenDisplayMode({
  editable,
  language,
  openedWithLine,
}: {
  editable: boolean;
  language?: string;
  openedWithLine: boolean;
}): FileViewerDisplayMode {
  if (openedWithLine) return "source";
  if (language === "markdown") return "preview";
  if (language === "html") return editable ? "edit" : "preview";
  return editable ? "edit" : "source";
}
