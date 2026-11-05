/**
 * `project_context` 压缩的回归测试。
 *
 * 背景：pi 无条件把 AGENTS.md 全文拼进系统提示词，本项目的 AGENTS.md 约 90KB，
 * 每轮请求都要发送。`lib/project-context-digest.ts` 把它换成路径，让模型按需 read。
 *
 * 这里锁住四件事：
 * 1. 有 `<project_context>` 时被替换成路径，原文不再出现在提示词里；
 * 2. 多个 AGENTS.md（全局 + 祖先目录）全部列出，不是只列第一个；
 * 3. `read` 不可用时原样返回 —— 给一条读不到的路径比多花 token 更糟；
 * 4. 结构与 pi 的 `renderProjectContext()` 保持一致，SDK 改了标签会在这里失败。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { digestProjectContext, isDigestedProjectContext } = await jiti.import(
  "./project-context-digest.ts",
);

/** 复刻 pi 的 `renderProjectContext()` 输出（含外层 `<project_context>` 包装）。 */
function renderPrompt(files) {
  const body = [
    "Project-specific instructions and guidelines:",
    ...files.map(
      ({ path, content }) =>
        `<project_instructions path="${path}">\n${content}\n</project_instructions>`,
    ),
  ].join("\n\n");
  return `<preamble>\nhi\n</preamble>\n\n<project_context>\n${body}\n</project_context>\n\n<cwd>\n/repo\n</cwd>`;
}

const FILES = [
  { path: "/repo/AGENTS.md", content: "# Rules\n\nNever run next build.\n".repeat(50) },
];

test("有 project_context 时替换成路径，原文消失", () => {
  const prompt = renderPrompt(FILES);
  const digested = digestProjectContext(prompt, "zh-CN", true);

  assert.ok(!digested.includes("Never run next build"), "原始 AGENTS.md 内容应被移除");
  assert.ok(!digested.includes("<project_instructions"), "project_instructions 标签应被移除");
  assert.ok(digested.includes("/repo/AGENTS.md"), "路径必须保留");
  assert.ok(digested.includes("用 read 工具完整读取"), "必须给出读取指引");
  assert.ok(digested.length < 600, `摘要应远小于原文，实际 ${digested.length} 字符`);
});

test("保留 project_context 之外的其它段", () => {
  const digested = digestProjectContext(renderPrompt(FILES), "zh-CN", true);
  assert.ok(digested.startsWith("<preamble>"), "preamble 段不能被吞掉");
  assert.ok(digested.includes("<cwd>\n/repo\n</cwd>"), "cwd 段不能被吞掉");
});

test("全局 AGENTS.md 与祖先目录 AGENTS.md 全部列出", () => {
  const digested = digestProjectContext(
    renderPrompt([
      { path: "/home/u/.pi/agent/AGENTS.md", content: "global" },
      { path: "/repo/AGENTS.md", content: "project" },
      { path: "/AGENTS.md", content: "root" },
    ]),
    "zh-CN",
    true,
  );
  for (const path of ["/home/u/.pi/agent/AGENTS.md", "/repo/AGENTS.md", "/AGENTS.md"]) {
    assert.ok(digested.includes(`- ${path}`), `应列出 ${path}`);
  }
});

test("read 不可用时原样返回", () => {
  const prompt = renderPrompt(FILES);
  assert.equal(digestProjectContext(prompt, "zh-CN", false), prompt);
});

test("没有 project_context 段时原样返回", () => {
  const prompt = "<preamble>\nhi\n</preamble>";
  assert.equal(digestProjectContext(prompt, "zh-CN", true), prompt);
});

test("有段但没有任何 project_instructions 时原样返回", () => {
  const prompt = "<preamble>\nhi\n</preamble>\n\n<project_context>\n空\n</project_context>";
  assert.equal(digestProjectContext(prompt, "zh-CN", true), prompt);
});

test("语言跟随界面", () => {
  const zh = digestProjectContext(renderPrompt(FILES), "zh-CN", true);
  const en = digestProjectContext(renderPrompt(FILES), "en", true);

  assert.ok(zh.includes("强制约定"));
  assert.ok(en.includes("binding conventions"));
  assert.ok(!en.includes("强制约定"), "英文模式不应残留中文");
  for (const prompt of [zh, en]) {
    assert.ok(prompt.includes("/repo/AGENTS.md"), "两种语言都必须带路径");
  }
});

test("isDigestedProjectContext 能区分原文与摘要", () => {
  assert.equal(isDigestedProjectContext(renderPrompt(FILES)), false);
  assert.equal(isDigestedProjectContext(digestProjectContext(renderPrompt(FILES), "zh-CN", true)), true);
  assert.equal(isDigestedProjectContext("<preamble>hi</preamble>"), false);
});

test("摘要与 SDK 的 project_context 包装保持一致", async () => {
  const source = await readFile(
    new URL(
      "../node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js",
      import.meta.url,
    ),
    "utf8",
  );
  // SDK 改了段名或路径属性的写法时，digest 的正则会静默失效（原文继续进请求）。
  assert.ok(source.includes("project_context"), "SDK 的段名 project_context 变了");
  assert.ok(
    source.includes('`<project_instructions path="${path}">'),
    "SDK 的 project_instructions 属性写法变了",
  );
});
