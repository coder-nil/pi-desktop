import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildQoderRequestBody, flattenMessages, normalizeTools } = await jiti.import("./request-body.ts");
const { decodeQoderBase64 } = await jiti.import("./qoder-base64.ts");
const { QODER_CN_STATIC_CATALOG } = await jiti.import("./catalog.ts");

const qwen = QODER_CN_STATIC_CATALOG.find((entry) => entry.key === "qmodel");
const kimi = QODER_CN_STATIC_CATALOG.find((entry) => entry.key === "kmodel_latest");

function decodeBody(encoded) {
  return JSON.parse(new TextDecoder().decode(decodeQoderBase64(encoded)));
}

const TOOL_HISTORY = [
  { role: "system", content: "pi 的 agent 提示词" },
  { role: "user", content: "列出文件" },
  {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "call_1", type: "function", function: { name: "bash", arguments: '{"cmd":"ls"}' } }],
  },
  { role: "tool", tool_call_id: "call_1", name: "bash", content: "a.txt" },
  { role: "user", content: "继续" },
];

test("系统提示词抽到 messages[0]，其余消息按序排列", () => {
  const body = decodeBody(buildQoderRequestBody(
    { messages: [{ role: "developer", content: "sys" }, { role: "user", content: "hi" }] },
    { modelKey: "kmodel_latest", catalog: kimi, userType: "personal_pro" },
  ));
  assert.deepEqual(body.messages[0], { role: "system", content: "sys" });
  assert.deepEqual(body.messages[1], { role: "user", content: "hi" });
  assert.equal(body.aliyun_user_type, "personal_pro");
});

test("白名单模型走结构化工具历史：保留 role:tool 与 tool_calls", () => {
  const body = decodeBody(buildQoderRequestBody(
    { messages: TOOL_HISTORY },
    { modelKey: "qmodel", catalog: qwen },
  ));
  const toolMessage = body.messages.find((message) => message.role === "tool");
  assert.ok(toolMessage, "结构化形态必须保留 tool 角色");
  assert.equal(toolMessage.tool_call_id, "call_1");
  assert.equal(toolMessage.content, "a.txt");
  const assistant = body.messages.find((message) => Array.isArray(message.tool_calls));
  assert.equal(assistant.tool_calls[0].id, "call_1");
  assert.equal(assistant.tool_calls[0].function.name, "bash");
});

test("非白名单模型把工具历史文本化（不丢内容、不发明 id）", () => {
  const body = decodeBody(buildQoderRequestBody(
    { messages: TOOL_HISTORY },
    { modelKey: "kmodel_latest", catalog: kimi },
  ));
  assert.equal(body.messages.some((message) => message.role === "tool"), false);
  const result = body.messages.find((message) => message.content.includes("[工具结果"));
  assert.ok(result, "工具结果必须降级成 user 文本");
  assert.match(result.content, /^\[工具结果 \(bash\)\]\na\.txt$/);
  const assistant = body.messages.find((message) => message.content.includes("[assistant 请求调用工具]"));
  assert.ok(assistant, "assistant 的调用意图必须序列化进正文");
  assert.match(assistant.content, /"name":"bash"/);
});

test("工具 id 不齐备时绝不发结构化历史（fail-safe）", () => {
  const broken = [
    { role: "assistant", tool_calls: [{ function: { name: "bash", arguments: "{}" } }] },
    { role: "tool", content: "x" },
  ];
  const structured = flattenMessages(broken, { structured: true, keepReasoning: false });
  // flattenMessages 只做机械转换；id 守卫在 buildQoderRequestBody 的模型白名单里，
  // 这里确认空 id 不会被伪造成别的值。
  assert.equal(structured.messages[0].tool_calls[0].id, "");
});

test("model_config / business / parameters 与目录元数据一致", () => {
  const body = decodeBody(buildQoderRequestBody(
    {
      messages: [{ role: "user", content: "你好，请介绍一下这个仓库的结构和主要模块" }],
      max_tokens: 4096,
      reasoning_effort: "medium",
    },
    { modelKey: "qmodel_38max", catalog: QODER_CN_STATIC_CATALOG.find((entry) => entry.key === "qmodel_38max") },
  ));
  assert.equal(body.model_config.key, "qmodel_38max");
  assert.equal(body.model_config.display_name, "Qwen3.8-Max");
  assert.equal(body.model_config.is_reasoning, true);
  assert.equal(body.model_config.is_vl, true);
  assert.equal(body.model_config.max_input_tokens, 180_000);
  assert.equal(body.parameters.max_tokens, 4096);
  assert.equal(body.parameters.reasoning_effort, "medium");
  // 计费归因读 business.model_key，缺了会被上游静默记到 auto。
  assert.equal(body.business.model_key, "qmodel_38max");
  assert.equal(body.business.product, "cli");
  assert.equal(body.session_type, "qodercli");
  assert.equal(body.agent_id, "agent_common");
  assert.equal(body.stream, true);
  assert.ok(body.business.name.length <= 30);
});

test("模型不支持的思考档位不发送（避免上游拒答）", () => {
  const body = decodeBody(buildQoderRequestBody(
    { messages: [{ role: "user", content: "hi" }], reasoning_effort: "medium" },
    { modelKey: "dmodel", catalog: QODER_CN_STATIC_CATALOG.find((entry) => entry.key === "dmodel") },
  ));
  // DeepSeek-V4-Pro 只支持 high / max。
  assert.equal(body.parameters.reasoning_effort, undefined);
});

test("平铺工具定义被包成 chat function schema，非 function 类型丢弃", () => {
  const tools = normalizeTools([
    { type: "function", name: "bash", description: "run", parameters: { type: "object" } },
    { type: "web_search" },
    { type: "function", function: { name: "read", parameters: { type: "object" } } },
  ]);
  assert.equal(tools.length, 2);
  assert.equal(tools[0].function.name, "bash");
  assert.equal(tools[1].function.name, "read");
});

test("同一段对话复用 business id / begin_at，用量面板不会把一轮拆成碎片", () => {
  const payload = { messages: [{ role: "system", content: "sys" }, { role: "user", content: "同一个开头" }] };
  const conversation = { id: "conv-1", beginAt: 1_700_000_000_000 };
  const first = decodeBody(buildQoderRequestBody(payload, { modelKey: "qmodel", catalog: qwen, conversation }));
  const second = decodeBody(buildQoderRequestBody(payload, { modelKey: "qmodel", catalog: qwen, conversation }));
  assert.equal(first.business.id, "conv-1");
  assert.equal(second.business.id, "conv-1");
  assert.equal(first.business.begin_at, conversation.beginAt);
  assert.equal(second.business.begin_at, conversation.beginAt);
  // request_id 必须每请求唯一：计费与限额都按请求计数。
  assert.notEqual(first.request_id, second.request_id);
});
