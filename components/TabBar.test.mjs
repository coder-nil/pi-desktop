import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./TabBar.tsx", import.meta.url), "utf8");

test("tab labels stay vertically centred when the tab bar has to scroll", () => {
  // overflow-x: auto 会在容器底部吃掉一行滚动条的高度（全局 ::-webkit-scrollbar
  // 是 4px）。标签若写死 36px，溢出时就被顶出容器顶部，文字看起来偏上。
  assert.match(source, /alignItems: "stretch"/);
  assert.doesNotMatch(source, /alignItems: "flex-end"/);
  assert.equal((source.match(/height: 36/g) ?? []).length, 1, "只有容器可以写死 36px 高度");
  assert.doesNotMatch(source, /height: 36,\s*\n\s*paddingLeft: 12,/);
});

test("the tab bar still scrolls horizontally instead of growing", () => {
  assert.match(source, /overflowX: "auto"/);
  assert.match(source, /whiteSpace: "nowrap"/);
  assert.match(source, /flexShrink: 0/);
});
