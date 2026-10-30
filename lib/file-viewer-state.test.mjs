import assert from "node:assert/strict";
import test from "node:test";

import { resolveInitialFileDisplayMode, defaultOpenDisplayMode } from "./file-viewer-state.ts";

test("a restored display mode wins over a stale open hint", () => {
  const state = {
    displayMode: "source",
    wrapLines: true,
    scrollTop: 80,
    scrollLeft: 0,
  };

  assert.equal(resolveInitialFileDisplayMode(state, "diff"), "source");
});

test("the open hint is used only before viewer state has been saved", () => {
  assert.equal(resolveInitialFileDisplayMode(undefined, "diff"), "diff");
  assert.equal(resolveInitialFileDisplayMode(), "source");
});

test("markdown opens as a rendered preview whether or not it is editable", () => {
  for (const editable of [true, false]) {
    assert.equal(defaultOpenDisplayMode({ editable, language: "markdown", openedWithLine: false }), "preview");
  }
});

test("html only previews when the viewer cannot edit it", () => {
  assert.equal(defaultOpenDisplayMode({ editable: false, language: "html", openedWithLine: false }), "preview");
  assert.equal(defaultOpenDisplayMode({ editable: true, language: "html", openedWithLine: false }), "edit");
});

test("other files keep the editor for editable viewers and source otherwise", () => {
  assert.equal(defaultOpenDisplayMode({ editable: true, language: "typescript", openedWithLine: false }), "edit");
  assert.equal(defaultOpenDisplayMode({ editable: false, language: "typescript", openedWithLine: false }), "source");
  // 内容还没回来时只知道能不能编辑
  assert.equal(defaultOpenDisplayMode({ editable: true, language: undefined, openedWithLine: false }), "edit");
  assert.equal(defaultOpenDisplayMode({ editable: false, language: undefined, openedWithLine: false }), "source");
});

test("a line-address link opens in source, where the line can actually be revealed", () => {
  for (const language of ["markdown", "html", "typescript"]) {
    assert.equal(defaultOpenDisplayMode({ editable: true, language, openedWithLine: true }), "source");
    assert.equal(defaultOpenDisplayMode({ editable: false, language, openedWithLine: true }), "source");
  }
});
