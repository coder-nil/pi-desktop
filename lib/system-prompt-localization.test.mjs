/**
 * 系统提示词中文化的回归测试。
 *
 * pi 生成的提示词是英文的，`SYSTEM_PROMPT_TRANSLATIONS`（lib/rpc-manager.ts）靠整句替换把它变成
 * 界面语言。SDK 每次给提示词加一句/一个主题，替换表就可能只命中前缀，留下「中文里拖英文尾巴」
 * 的半句话（1.4.0 给 docs 段加了 `MCP servers (docs/mcp.md)` 与 codemode 主题时就是这样）。
 *
 * 这里直接读 SDK 的提示词源码：把已被翻译表覆盖的文本抹掉后，剩下的英文片段就是漏翻的部分。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const SDK_DIST = new URL(
  "../node_modules/@earendil-works/pi-coding-agent/dist/",
  import.meta.url,
);

async function loadTranslations() {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const start = source.indexOf("const SYSTEM_PROMPT_TRANSLATIONS");
  assert.notEqual(start, -1, "SYSTEM_PROMPT_TRANSLATIONS not found in rpc-manager.ts");
  const end = source.indexOf("\n};", start);
  const block = source.slice(start, end);
  const pairs = [...block.matchAll(/"((?:[^"\\]|\\.)*)": "((?:[^"\\]|\\.)*)"/g)]
    .map((match) => JSON.parse(`"${match[1]}"`));
  assert.ok(pairs.length > 20, `expected the translation table, got ${pairs.length} entries`);
  return pairs;
}

async function readSdk() {
  try {
    const systemPrompt = await readFile(new URL("core/system-prompt.js", SDK_DIST), "utf8");
    const skills = await readFile(new URL("core/skills.js", SDK_DIST), "utf8");
    const toolsDir = new URL("core/tools/", SDK_DIST);
    const toolNames = (await readdir(toolsDir)).filter((name) => name.endsWith(".js"));
    const tools = new Map();
    for (const name of toolNames) {
      tools.set(name, await readFile(new URL(name, toolsDir), "utf8"));
    }
    return { systemPrompt, skills, tools };
  } catch {
    return null;
  }
}

/** 已翻译的句子、路径与文件名删掉后，剩下的英文单词就是漏翻内容。 */
const ALLOWED_RESIDUE = [
  /docs\/[\w./-]*/g,
  /examples\/[\w./-]*/g,
  /[\w./-]+\.md/g,
  /\$\{[^}]*\}/g,
  /\bPi\b/g,
  /\bTUI\b/g,
  /\bSDK\b/g,
  /\bMCP\b/g,
  /\bLaTeX\b/g,
];

function leftoverEnglish(text, translations) {
  let rest = text;
  // 长句先替换，避免短 key 抢先吃掉长句的一部分。
  for (const key of [...translations].sort((a, b) => b.length - a.length)) {
    rest = rest.split(key).join(" ");
  }
  for (const pattern of ALLOWED_RESIDUE) rest = rest.replace(pattern, " ");
  return rest;
}

/** 提取文本里连续出现的英文单词片段（≥3 个字母的单词，至少两个）。 */
function englishPhrases(text) {
  const phrases = [];
  for (const match of text.matchAll(/[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*)+/g)) {
    const words = match[0].split(/\s+/).filter((word) => word.length >= 3);
    if (words.length >= 2) phrases.push(match[0].trim());
  }
  return phrases;
}

function assertNoLeftovers(label, text, translations) {
  const phrases = englishPhrases(leftoverEnglish(text, translations));
  assert.deepEqual(phrases, [], `${label} 仍有未翻译的英文：${phrases.join(" | ")}`);
}

test("system prompt translations cover everything pi generates", async () => {
  const sdk = await readSdk();
  if (!sdk) {
    // 发布包里没有 SDK 源码，这类环境只跳过源码级检查。
    return;
  }
  const translations = await loadTranslations();

  const preamble = sdk.systemPrompt.match(/promptSections\.preamble =[\s\S]*?"((?:[^"\\]|\\.)*)";/);
  assert.ok(preamble, "preamble literal not found in the SDK system prompt source");
  assertNoLeftovers("preamble", JSON.parse(`"${preamble[1]}"`), translations);

  const docs = sdk.systemPrompt.match(/promptSections\.docs = `([\s\S]*?)`;/);
  assert.ok(docs, "docs section template not found in the SDK system prompt source");
  for (const line of docs[1].split("\n")) {
    assertNoLeftovers(`docs「${line.slice(0, 40)}」`, line, translations);
  }

  for (const match of sdk.systemPrompt.matchAll(/addRule\("((?:[^"\\]|\\.)*)"\)/g)) {
    assertNoLeftovers(`rule「${match[1].slice(0, 40)}」`, JSON.parse(`"${match[1]}"`), translations);
  }
});

test("skill list prompts are translated", async () => {
  const sdk = await readSdk();
  if (!sdk) return;
  const translations = await loadTranslations();

  const lines = sdk.skills.match(/const lines = \[([\s\S]*?)\];/);
  assert.ok(lines, "formatSkillsForPrompt list not found in the SDK skills source");
  const sentences = [...lines[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)]
    .map((match) => JSON.parse(`"${match[1]}"`).trim())
    .filter((sentence) => sentence.length > 0 && sentence.includes(" "));
  assert.ok(sentences.length >= 3, "expected the skill list sentences");
  for (const sentence of sentences) {
    assert.ok(
      translations.includes(sentence),
      `skills 段的句子缺少翻译：${JSON.stringify(sentence)}`,
    );
  }
});

test("every built-in tool snippet and guideline is translated", async () => {
  const sdk = await readSdk();
  if (!sdk) return;
  const translations = await loadTranslations();

  const missing = [];
  for (const [file, source] of sdk.tools) {
    for (const match of source.matchAll(/snippet:\s*"((?:[^"\\]|\\.)*)"/g)) {
      const snippet = JSON.parse(`"${match[1]}"`);
      if (!translations.includes(snippet)) missing.push(`${file} snippet: ${snippet}`);
    }
    for (const match of source.matchAll(/guidelines:\s*\[([\s\S]*?)\]/g)) {
      for (const literal of match[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
        const guideline = JSON.parse(`"${literal[1]}"`);
        // 桌面自带的 system_time 指引不属于 SDK 文本，但仍需翻译。
        if (!translations.includes(guideline)) missing.push(`${file} guideline: ${guideline}`);
      }
    }
  }
  assert.deepEqual(missing, [], `内置工具描述缺少翻译：\n${missing.join("\n")}`);
});

/** 桌面自带工具（system_time / ask_user / task_progress / bash 凭据规则）的英文提示词文案。 */
async function desktopPromptStrings() {
  const libDir = new URL("./", import.meta.url);
  const files = (await readdir(libDir)).filter((name) => name.endsWith(".ts"));
  const strings = [];
  for (const name of files) {
    const source = await readFile(new URL(name, libDir), "utf8");
    for (const match of source.matchAll(/promptSnippet:\s*"((?:[^"\\]|\\.)*)"/g)) {
      strings.push({ file: name, kind: "promptSnippet", text: JSON.parse(`"${match[1]}"`) });
    }
    for (const match of source.matchAll(/promptGuidelines:\s*\[([\s\S]*?)\]/g)) {
      for (const literal of match[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
        strings.push({ file: name, kind: "promptGuidelines", text: JSON.parse(`"${literal[1]}"`) });
      }
    }
    for (const match of source.matchAll(/CREDENTIAL_PROMPT_GUIDELINE = "((?:[^"\\]|\\.)*)"/g)) {
      strings.push({ file: name, kind: "CREDENTIAL_PROMPT_GUIDELINE", text: JSON.parse(`"${match[1]}"`) });
    }
  }
  return strings;
}

test("desktop-owned tool prompts are translated", async () => {
  const translations = await loadTranslations();
  const strings = await desktopPromptStrings();
  assert.ok(strings.length >= 15, `expected the desktop tool prompts, got ${strings.length}`);
  // pi 渲染成 `- <name>: <snippet>`，snippet 自带工具名前缀就会出现 `system_time: system_time: …`。
  const prefixed = strings
    .filter((entry) => entry.kind === "promptSnippet" && /^[a-z][a-z0-9_]*: /.test(entry.text))
    .map((entry) => `${entry.file}: ${entry.text}`);
  assert.deepEqual(prefixed, [], `promptSnippet 不要自带工具名前缀：\n${prefixed.join("\n")}`);
  const missing = strings
    .filter((entry) => !translations.includes(entry.text))
    .map((entry) => `${entry.file} ${entry.kind}: ${entry.text}`);
  assert.deepEqual(missing, [], `桌面工具描述缺少翻译：\n${missing.join("\n")}`);
});
