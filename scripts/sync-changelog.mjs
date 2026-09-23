import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "CHANGELOG.md");
const destination = join(root, "data", "changelog.json");
const check = process.argv.includes("--check");
const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const SUPPORTED_HEADINGS = new Set(["added", "changed", "fixed", "removed", "deprecated", "security"]);

/**
 * 解析 `## [版本] - 日期` 小节。返回值保留原始英文小节标题，中文标题由界面
 * 通过 i18n 映射，避免同一份数据在两处各写一遍文案。
 */
export function parseChangelog(markdown) {
  const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(newline);
  const releases = [];
  let release = null;
  let section = null;

  for (const line of lines) {
    const heading = /^##\s+\[([^\]]+)\](?:\s*-\s*(.*))?\s*$/.exec(line);
    if (heading) {
      release = { version: heading[1].trim(), date: (heading[2] ?? "").trim(), sections: [] };
      releases.push(release);
      section = null;
      continue;
    }
    if (!release) continue;

    const sectionHeading = /^###\s+(.+?)\s*$/.exec(line);
    if (sectionHeading) {
      const title = sectionHeading[1].trim();
      section = { title, kind: SUPPORTED_HEADINGS.has(title.toLowerCase()) ? title.toLowerCase() : "other", items: [] };
      release.sections.push(section);
      continue;
    }
    if (!section) continue;

    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (item) section.items.push(item[1].trim());
  }

  return releases.filter((entry) => entry.version);
}

const parsed = parseChangelog(readFileSync(source, "utf8"));
const serialized = `${JSON.stringify(parsed, null, 2)}\n`;

// 被 `sync-changelog.test.mjs` 当模块导入时只借 parseChangelog，不能改仓库文件。
if (!isEntryPoint) {
  // 什么也不做。
} else if (check) {
  let current = "";
  try {
    current = readFileSync(destination, "utf8");
  } catch {
    current = "";
  }
  if (current !== serialized) {
    console.error("data/changelog.json is out of date. Run `npm run changelog:sync`.");
    process.exit(1);
  }
  console.log(`Verified data/changelog.json (${parsed.length} releases).`);
} else {
  writeFileSync(destination, serialized);
  console.log(`Wrote data/changelog.json (${parsed.length} releases).`);
}
