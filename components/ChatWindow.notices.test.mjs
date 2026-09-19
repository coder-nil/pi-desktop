import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("renders temporary notices once at the top center of the chat column", () => {
  const noticeShelfUsages = source.match(/<NoticeShelf notices=\{notices\}/g) ?? [];

  assert.equal(noticeShelfUsages.length, 1);
  // The minimap rail is a sibling column outside ChatWindow now, so the shelf
  // spans the whole chat column and must not reserve the rail width anymore.
  assert.match(
    source,
    /position: "absolute",\s*top: 12,\s*left: 0,\s*right: 0,[\s\S]*?justifyContent: "center",[\s\S]*?<NoticeShelf notices=\{notices\} floating \/>/,
  );
  assert.doesNotMatch(source, /right: isMobile \? 0 : CHAT_MINIMAP_WIDTH/);
});
