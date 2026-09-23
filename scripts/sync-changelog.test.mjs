import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const { parseChangelog } = await import("./sync-changelog.mjs");

const SAMPLE = [
  "# Changelog",
  "",
  "## [1.2.3] - 2026-01-02",
  "",
  "### Added",
  "",
  "- 第一条 `code` 内容。",
  "- 第二条",
  "",
  "### Fixed",
  "",
  "- 修了 A",
  "",
  "## [1.2.2]",
  "",
  "### 其它",
  "",
  "- 无日期小节",
  "",
].join("\n");

test("parses releases, sections and items", () => {
  const releases = parseChangelog(SAMPLE);

  assert.deepEqual(releases.map((release) => release.version), ["1.2.3", "1.2.2"]);
  assert.equal(releases[0].date, "2026-01-02");
  assert.deepEqual(releases[0].sections.map((section) => section.kind), ["added", "fixed"]);
  assert.equal(releases[0].sections[0].items.length, 2);
  assert.equal(releases[0].sections[0].items[0], "第一条 `code` 内容。");
  // 没有日期的小节仍然可用。
  assert.equal(releases[1].date, "");
  // 中文小节标题映射成 other，界面用 i18n 文案兜底。
  assert.equal(releases[1].sections[0].kind, "other");
  assert.equal(releases[1].sections[0].title, "其它");
});

test("keeps the repository changelog and the bundled json in sync", () => {
  const markdown = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  const bundled = readFileSync(new URL("../data/changelog.json", import.meta.url), "utf8");
  const parsed = parseChangelog(markdown);

  assert.ok(parsed.length > 0);
  assert.equal(bundled, `${JSON.stringify(parsed, null, 2)}\n`);
});
