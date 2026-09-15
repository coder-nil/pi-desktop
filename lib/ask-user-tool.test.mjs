import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  createAskUserExtension,
  formatAskUserSummary,
  normalizeAskUserInput,
} = await jiti.import("./ask-user-tool.ts");

function registerAskUserTool() {
  let registeredTool;
  createAskUserExtension().factory({
    registerTool(tool) {
      registeredTool = tool;
    },
  });
  return registeredTool;
}

test("registers ask_user with multi-question guidance", () => {
  const tool = registerAskUserTool();
  assert.equal(tool.name, "ask_user");
  assert.match(tool.description, /one call with 1-3 related questions/);
  assert.match(tool.promptGuidelines.join("\n"), /put every question in its questions array/);
  assert.match(tool.promptGuidelines.join("\n"), /never request passwords/);
  assert.match(tool.promptGuidelines.join("\n"), /secure credential prompt/);
  assert.equal(tool.parameters.properties.questions.maxItems, 3);
  const questionSchema = tool.parameters.properties.questions.items;
  assert.ok(questionSchema.required.includes("options"));
  assert.equal(questionSchema.properties.options.minItems, 0);
  assert.match(questionSchema.properties.options.description, /empty array for confirm/);
});

test("normalizes a bounded multi-question request", () => {
  const result = normalizeAskUserInput({
    questions: [
      {
        id: "scope",
        prompt: "修改范围？",
        kind: "single_select",
        options: [
          { value: "frontend", label: "仅前端" },
          { value: "full_stack", label: "前后端" },
        ],
      },
      { id: "tests", prompt: "运行测试？", kind: "confirm", options: [] },
    ],
    timeoutMs: 30_000,
  });

  assert.equal(result.questions.length, 2);
  assert.equal(result.questions[0].options[1].value, "full_stack");
  assert.deepEqual(result.questions[1].options, []);
  assert.equal(result.timeoutMs, 30_000);
});

test("rejects duplicate question ids and invalid select options", () => {
  assert.throws(
    () => normalizeAskUserInput({
      questions: [
        { id: "same", prompt: "A", kind: "text" },
        { id: "same", prompt: "B", kind: "text" },
      ],
    }),
    /question ids must be unique/,
  );

  assert.throws(
    () => normalizeAskUserInput({
      questions: [{
        id: "scope",
        prompt: "范围？",
        kind: "single_select",
        options: [{ value: "only", label: "唯一选项" }],
      }],
    }),
    /between 2 and 8 options/,
  );

  assert.throws(
    () => normalizeAskUserInput({
      questions: [{
        id: "confirm",
        prompt: "继续？",
        kind: "confirm",
        options: [{ value: "yes", label: "是" }, { value: "no", label: "否" }],
      }],
    }),
    /must use an empty options array/,
  );
});

test("asks questions in order and returns structured answers", async () => {
  const tool = registerAskUserTool();
  const calls = [];
  const ui = {
    select: async (title, options) => {
      calls.push(["select", title, options]);
      return "前后端";
    },
    confirm: async (title) => {
      calls.push(["confirm", title]);
      return true;
    },
    input: async () => {
      throw new Error("input should not be called");
    },
    editor: async () => {
      throw new Error("editor should not be called");
    },
  };

  const result = await tool.execute("call-1", {
    questions: [
      {
        id: "scope",
        prompt: "修改范围？",
        kind: "single_select",
        options: [
          { value: "frontend", label: "仅前端" },
          { value: "full_stack", label: "前后端" },
        ],
      },
      { id: "tests", prompt: "运行测试？", kind: "confirm" },
    ],
  }, undefined, undefined, { hasUI: true, ui });

  assert.deepEqual(calls, [
    ["select", "[1/2] 修改范围？", ["仅前端", "前后端"]],
    ["confirm", "[2/2] 运行测试？"],
  ]);
  assert.deepEqual(result.details, {
    status: "answered",
    answers: {
      scope: { value: "full_stack", label: "前后端" },
      tests: { value: true },
    },
  });
  assert.match(result.content[0].text, /scope: 前后端/);
  assert.match(formatAskUserSummary(result.details), /tests: true/);
});

test("returns cancelled when a text prompt is dismissed", async () => {
  const tool = registerAskUserTool();
  const result = await tool.execute("call-2", {
    questions: [{ id: "name", prompt: "名称？", kind: "text" }],
  }, undefined, undefined, {
    hasUI: true,
    ui: {
      select: async () => undefined,
      confirm: async () => false,
      input: async () => undefined,
      editor: async () => undefined,
    },
  });

  assert.deepEqual(result.details, { status: "cancelled", answers: {} });
  assert.equal(result.content[0].text, "User cancelled the questions.");
});
