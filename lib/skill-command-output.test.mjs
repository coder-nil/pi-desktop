import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { formatSkillCommandOutput } = await jiti.import("./skill-command-output.ts");

// skills CLI 的 FIGlet banner（`skills`），真实输出里每行带 38;5;NNN 前景色。
const BANNER = [
  "\u001b[38;5;250m███████╗██╗  ██╗██╗██╗     ██╗     ███████╗\u001b[0m",
  "\u001b[38;5;248m██╔════╝██║ ██╔╝██║██║     ██║     ██╔════╝\u001b[0m",
  "\u001b[38;5;245m███████╗█████╔╝ ██║██║     ██║     ███████╗\u001b[0m",
  "\u001b[38;5;243m╚════██║██╔═██╗ ██║██║     ██║     ╚════██║\u001b[0m",
  "\u001b[38;5;240m███████║██║  ██╗██║███████╗███████╗███████║\u001b[0m",
  "\u001b[38;5;238m╚══════╝╚═╝  ╚═╝╚═╝╚══════╝╚══════╝╚══════╝\u001b[0m",
].join("\n");

test("drops the FIGlet banner so a timed-out run is not a wall of block glyphs", () => {
  const output = formatSkillCommandOutput(`${BANNER}\n┌   skills\n├  waiting\n`);
  assert.equal(output.includes("█"), false);
  assert.equal(output.includes("╔"), false);
  // banner 之外的真实内容保留
  assert.match(output, /┌ {3}skills/);
});

test("drops spinner frames that carry a rotating glyph", () => {
  // 真实帧形如 `◒  Cloning repository…`：旋转字形在行首，原正则锚 ^Cloning 因而漏掉。
  const frames = ["◐", "◓", "◑", "◒"].map((glyph) => `\u001b[1G\u001b[J${glyph}  Cloning repository…`).join("");
  const output = formatSkillCommandOutput(`${frames}\n◇  Repository cloned\n`);
  assert.equal(/Cloning repository/.test(output), false);
  assert.match(output, /Repository cloned/);
});

test("keeps real result lines and their box borders", () => {
  const raw = [
    "◇  Installation Summary ───────────────╮",
    "│  ./.agents/skills/design-taste-frontend  │",
    "│    copy → Pi                             │",
    "╰──────────────────────────────────────────╯",
    "└  Done!  Review skills before use.",
  ].join("\n");
  const output = formatSkillCommandOutput(raw);
  assert.match(output, /Installation Summary/);
  assert.match(output, /design-taste-frontend/);
  assert.match(output, /copy → Pi/);
  assert.match(output, /Done!/);
});

test("never eats a content line that happens to contain a border glyph", () => {
  // 行里出现字母数字就说明是真内容，不能因为含 │ 就丢掉。
  const output = formatSkillCommandOutput("│  skills-lock.json 已更新 │\n");
  assert.match(output, /skills-lock\.json/);
});

test("collapses duplicated frames and keeps the tail", () => {
  const raw = ["◒  Cloning repository…", "◓  Cloning repository…", "◇  Found 3 skills"].join("\n");
  const output = formatSkillCommandOutput(raw);
  assert.equal(output.split("\n").filter(Boolean).length, 1);
  assert.match(output, /Found 3 skills/);
});
