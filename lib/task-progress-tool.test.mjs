import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  createTaskProgressExtension,
  formatTaskProgressLines,
  normalizeTaskProgressInput,
} = await jiti.import("./task-progress-tool.ts");

function registerTaskProgressExtension() {
  let registeredTool;
  const handlers = new Map();
  createTaskProgressExtension().factory({
    registerTool(tool) {
      registeredTool = tool;
    },
    on(name, handler) {
      handlers.set(name, handler);
    },
  });
  return { tool: registeredTool, handlers };
}

function createContext(branch = []) {
  const calls = [];
  return {
    calls,
    context: {
      sessionManager: { getBranch: () => branch },
      ui: {
        setStatus: (...args) => calls.push(["status", ...args]),
        setWidget: (...args) => calls.push(["widget", ...args]),
      },
    },
  };
}

test("registers task_progress with Desktop progress guidance", () => {
  const { tool } = registerTaskProgressExtension();
  assert.equal(tool.name, "task_progress");
  assert.match(tool.description, /Pi Desktop interface/);
  assert.match(tool.promptSnippet, /Desktop task list/);
  assert.match(tool.promptGuidelines.join("\n"), /Immediately before working on a task/);
  assert.match(tool.promptGuidelines.join("\n"), /no task is incorrectly left in_progress/);
  assert.match(tool.promptGuidelines.join("\n"), /automatically hides the task list/);
});

test("normalizes replace and update inputs", () => {
  assert.deepEqual(normalizeTaskProgressInput({
    action: "replace",
    tasks: [
      { id: "inspect", title: "Inspect code", status: "completed" },
      { id: "implement", title: "Implement UI", status: "in_progress", detail: "Editing files" },
    ],
  }), {
    action: "replace",
    tasks: [
      { id: "inspect", title: "Inspect code", status: "completed" },
      { id: "implement", title: "Implement UI", status: "in_progress", detail: "Editing files" },
    ],
  });

  assert.deepEqual(normalizeTaskProgressInput({
    action: "update",
    id: "implement",
    status: "completed",
  }), {
    action: "update",
    id: "implement",
    status: "completed",
  });
});

test("rejects duplicate ids and multiple in-progress tasks", () => {
  assert.throws(() => normalizeTaskProgressInput({
    action: "replace",
    tasks: [
      { id: "same", title: "A", status: "pending" },
      { id: "same", title: "B", status: "pending" },
    ],
  }), /task ids must be unique/);

  assert.throws(() => normalizeTaskProgressInput({
    action: "replace",
    tasks: [
      { id: "a", title: "A", status: "in_progress" },
      { id: "b", title: "B", status: "in_progress" },
    ],
  }), /only one task may be in_progress/);
});

test("updates the Desktop widget and returns a persistent state snapshot", async () => {
  const { tool } = registerTaskProgressExtension();
  const { context, calls } = createContext();

  const result = await tool.execute("call-1", {
    action: "replace",
    tasks: [
      { id: "inspect", title: "分析代码", status: "completed" },
      { id: "implement", title: "实现界面", status: "in_progress", detail: "正在编辑" },
      { id: "verify", title: "运行验证", status: "pending" },
    ],
  }, undefined, undefined, context);

  assert.deepEqual(result.details.tasks, [
    { id: "inspect", title: "分析代码", status: "completed" },
    { id: "implement", title: "实现界面", status: "in_progress", detail: "正在编辑" },
    { id: "verify", title: "运行验证", status: "pending" },
  ]);
  assert.deepEqual(calls[0], ["status", "task-progress", "任务 1/3 · 正在执行：实现界面"]);
  assert.equal(calls[1][0], "widget");
  assert.equal(calls[1][1], "任务进度");
  assert.deepEqual(calls[1][2], [
    "已完成 1/3",
    "✓ 分析代码",
    "● 实现界面 — 正在编辑",
    "○ 运行验证",
  ]);
  assert.deepEqual(calls[1][3], { placement: "aboveEditor" });

  const completed = await tool.execute("call-2", {
    action: "update",
    id: "implement",
    status: "completed",
  }, undefined, undefined, context);
  assert.deepEqual(completed.details.tasks[1], {
    id: "implement",
    title: "实现界面",
    status: "completed",
  });

  await tool.execute("call-3", {
    action: "update",
    id: "verify",
    status: "skipped",
  }, undefined, undefined, context);
  assert.deepEqual(calls.slice(-2), [
    ["widget", "任务进度", undefined],
    ["status", "task-progress", undefined],
  ]);
});

test("keeps failed or blocked task lists visible", async () => {
  const { tool } = registerTaskProgressExtension();
  const { context, calls } = createContext();

  await tool.execute("call-blocked", {
    action: "replace",
    tasks: [{ id: "verify", title: "运行验证", status: "blocked", detail: "等待 CI" }],
  }, undefined, undefined, context);

  assert.deepEqual(calls[0], ["status", "task-progress", "任务 0/1 · 已阻塞：运行验证"]);
  assert.equal(calls[1][0], "widget");
});

test("restores completed task state without reopening the widget", async () => {
  const { handlers } = registerTaskProgressExtension();
  const branch = [{
    type: "message",
    message: {
      role: "toolResult",
      toolName: "task_progress",
      details: { tasks: [{ id: "done", title: "已完成", status: "completed" }] },
    },
  }];
  const { context, calls } = createContext(branch);

  await handlers.get("session_start")({}, context);

  assert.deepEqual(calls, [
    ["widget", "任务进度", undefined],
    ["status", "task-progress", undefined],
  ]);
});

test("restores task progress from the current session branch", async () => {
  const { handlers } = registerTaskProgressExtension();
  const branch = [{
    type: "message",
    message: {
      role: "toolResult",
      toolName: "task_progress",
      details: { tasks: [{ id: "verify", title: "运行验证", status: "blocked", detail: "等待 CI" }] },
    },
  }];
  const { context, calls } = createContext(branch);

  await handlers.get("session_start")({}, context);

  assert.deepEqual(calls[0], ["status", "task-progress", "任务 0/1 · 已阻塞：运行验证"]);
  assert.deepEqual(calls[1][2], ["已完成 0/1", "! 运行验证 — 等待 CI"]);
});

test("formats all supported task states for the Desktop widget", () => {
  assert.deepEqual(formatTaskProgressLines([
    { id: "1", title: "等待", status: "pending" },
    { id: "2", title: "执行", status: "in_progress" },
    { id: "3", title: "完成", status: "completed" },
    { id: "4", title: "失败", status: "failed" },
    { id: "5", title: "阻塞", status: "blocked" },
    { id: "6", title: "跳过", status: "skipped" },
  ]), [
    "已完成 2/6",
    "○ 等待",
    "● 执行",
    "✓ 完成",
    "✕ 失败",
    "! 阻塞",
    "− 跳过",
  ]);
});
