import assert from "node:assert/strict";
import test from "node:test";

import { openFileTab, markFileTabRevealHandled, saveFileViewerState } from "./file-tab-state.ts";

const tabA = {
  id: "file:/repo/a.ts",
  label: "a.ts",
  filePath: "/repo/a.ts",
  viewerRevision: 0,
  viewerState: {
    displayMode: "source",
    wrapLines: true,
    scrollTop: 240,
    scrollLeft: 16,
  },
};

const tabB = {
  id: "file:/repo/b.ts",
  label: "b.ts",
  filePath: "/repo/b.ts",
  viewerRevision: 0,
};

const openA = {
  fileName: "a.ts",
  filePath: "/repo/a.ts",
  tabId: "file:/repo/a.ts",
};

test("saving viewer state updates only the matching revision", () => {
  const tabs = [tabA, tabB];
  const nextState = { ...tabA.viewerState, scrollTop: 480 };
  const saved = saveFileViewerState(tabs, tabA.id, 0, nextState);

  assert.notStrictEqual(saved, tabs);
  assert.deepEqual(saved[0].viewerState, nextState);
  assert.strictEqual(saved[1], tabB);

  const stale = saveFileViewerState(saved, tabA.id, 9, tabA.viewerState);
  assert.strictEqual(stale, saved);
});

test("saving an unchanged viewer state preserves the tab array", () => {
  const tabs = [tabA, tabB];
  const saved = saveFileViewerState(tabs, tabA.id, 0, { ...tabA.viewerState });

  assert.strictEqual(saved, tabs);
});

test("opening an existing tab normally preserves its state and revision", () => {
  const tabs = [tabA, tabB];
  assert.strictEqual(openFileTab(tabs, openA), tabs);
});

test("changing the source session remounts the viewer without losing its state", () => {
  const [next] = openFileTab([tabA], { ...openA, sourceSessionId: "session-2" });
  assert.equal(next.sourceSessionId, "session-2");
  assert.equal(next.viewerRevision, 1);
  assert.strictEqual(next.viewerState, tabA.viewerState);
});

test("opening from the same source session preserves the viewer revision", () => {
  const tab = { ...tabA, sourceSessionId: "session-1" };
  const tabs = [tab];
  assert.strictEqual(
    openFileTab(tabs, { ...openA, sourceSessionId: "session-1" }),
    tabs,
  );
});

test("changing source while forcing diff increments the revision once", () => {
  const [next] = openFileTab([tabA], {
    ...openA,
    sourceSessionId: "session-2",
    modeHint: "diff",
  });
  assert.equal(next.sourceSessionId, "session-2");
  assert.equal(next.viewerRevision, 1);
  assert.equal(next.viewerState.displayMode, "diff");
});

test("every explicit diff activation resets the mode and increments the revision", () => {
  const first = openFileTab([tabA, tabB], { ...openA, modeHint: "diff" });
  assert.equal(first[0].viewerRevision, 1);
  assert.deepEqual(first[0].viewerState, {
    displayMode: "diff",
    wrapLines: true,
    scrollTop: 0,
    scrollLeft: 0,
  });

  const returnedToSource = saveFileViewerState(first, tabA.id, 1, tabA.viewerState);
  const second = openFileTab(returnedToSource, { ...openA, modeHint: "diff" });
  assert.equal(second[0].viewerRevision, 2);
  assert.equal(second[0].viewerState.displayMode, "diff");
});

test("a remounted viewer ignores the previous revision's late cleanup", () => {
  const reopened = openFileTab([tabA], { ...openA, modeHint: "diff" });
  const stale = saveFileViewerState(reopened, tabA.id, 0, tabA.viewerState);
  assert.strictEqual(stale, reopened);
  assert.equal(stale[0].viewerState.displayMode, "diff");
});

test("a linked line is revealed once, then dropped from the tab", () => {
  const opened = openFileTab([], { ...openA, line: 42 });
  assert.equal(opened[0].revealLine, 42);
  assert.equal(opened[0].viewerRevision, 0);

  // 同一文件再点另一行：换目标行并重建查看器，否则初始行不会重新生效。
  const relocated = openFileTab(opened, { ...openA, line: 77 });
  assert.equal(relocated[0].revealLine, 77);
  assert.equal(relocated[0].viewerRevision, 1);
  assert.equal(relocated[0].viewerState, undefined);

  // 查看器完成定位后标记被清掉，切回标签页不会重复跳。
  const handled = markFileTabRevealHandled(relocated, openA.tabId);
  assert.equal(handled[0].revealLine, undefined);
  assert.equal(handled[0].viewerRevision, 1);
  assert.strictEqual(markFileTabRevealHandled(handled, openA.tabId), handled);
  assert.strictEqual(markFileTabRevealHandled(handled, "file:/repo/missing.ts"), handled);
});

test("opening a file without a line keeps the tab untouched", () => {
  const tabs = [tabA, tabB];
  assert.strictEqual(openFileTab(tabs, openA), tabs);
  assert.equal(openFileTab([tabA], openA)[0].revealLine, undefined);
});
