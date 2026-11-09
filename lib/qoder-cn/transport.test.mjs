import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { cleanChunk, createQoderCnFetch } = await jiti.import("./transport.ts");
const { decodeQoderBase64 } = await jiti.import("./qoder-base64.ts");
const { QODER_CN_STATIC_CATALOG } = await jiti.import("./catalog.ts");

const CREDENTIAL = { uid: "u-1", accessToken: "token-1", userType: "personal_pro" };

function entry(key) {
  return QODER_CN_STATIC_CATALOG.find((model) => model.key === key);
}

/** 用假的全局 fetch 捕获上游请求，并回一段信封 SSE。 */
async function withFakeUpstream(envelopes, run) {
  const captured = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    captured.push({ url: String(input), init });
    const body = envelopes.map((envelope) => `data:${JSON.stringify(envelope)}\n\n`).join("");
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  try {
    return await run(captured);
  } finally {
    globalThis.fetch = original;
  }
}

function fetchImpl() {
  return createQoderCnFetch({
    loadCredential: async () => CREDENTIAL,
    catalogFor: (modelId) => entry(modelId) ?? entry("qmodel"),
    resolveModelKey: (modelId) => modelId,
  });
}

function openAiRequest(body) {
  return new Request("https://gateway.qoder.com.cn/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("cleanChunk 去掉空噪声字段并补标准 cached_tokens 位", () => {
  const cleaned = JSON.parse(cleanChunk(JSON.stringify({
    choices: [{ delta: { content: "hi", tool_calls: [], refusal: "", extra_fields: null } }],
    usage: { prompt_tokens: 10, prompt_cache_hit_tokens: 6 },
  })));
  assert.deepEqual(cleaned.choices[0].delta, { content: "hi" });
  assert.equal(cleaned.usage.prompt_tokens_details.cached_tokens, 6);
});

test("整段 delta 都是噪声时该帧被丢弃", () => {
  assert.equal(cleanChunk(JSON.stringify({ choices: [{ delta: { tool_calls: [], refusal: "" } }] })), "");
});

test("信封流被拆回标准 OpenAI chunk，并以 [DONE] 结束", async () => {
  await withFakeUpstream([
    { headers: { "Content-Type": ["application/json"] }, body: JSON.stringify({ choices: [{ delta: { content: "你" } }] }), statusCodeValue: 200 },
    { body: JSON.stringify({ choices: [{ delta: { content: "好" }, finish_reason: "stop" }] }), statusCodeValue: 200 },
    { body: "[DONE]" },
  ], async () => {
    const response = await fetchImpl()(openAiRequest({ model: "qmodel", messages: [{ role: "user", content: "hi" }] }), {});
    assert.equal(response.status, 200);
    const text = await response.text();
    const dataLines = text.split("\n").filter((line) => line.startsWith("data: "));
    assert.equal(dataLines.length, 3);
    assert.match(dataLines[0], /"content":"你"/);
    assert.match(dataLines[1], /"finish_reason":"stop"/);
    assert.equal(dataLines[2], "data: [DONE]");
  });
});

test("请求被改写成 Qoder 形态：模型键、COSY 头、编码后的 body", async () => {
  await withFakeUpstream([{ body: "[DONE]" }], async (captured) => {
    await fetchImpl()(openAiRequest({
      model: "qmodel_38max",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1024,
    }), {});
    const [call] = captured;
    assert.match(call.url, /\/algo\/api\/v2\/service\/pro\/sse\/agent_chat_generation\?/);
    const headers = new Headers(call.init.headers);
    assert.match(headers.get("authorization"), /^Bearer COSY\./);
    assert.equal(headers.get("x-model-key"), "qmodel_38max");
    assert.equal(headers.get("accept"), "text/event-stream");
    const body = JSON.parse(new TextDecoder().decode(decodeQoderBase64(call.init.body)));
    assert.equal(body.model_config.key, "qmodel_38max");
    assert.equal(body.stream, true);
  });
});

test("同一段对话的多次请求复用 business.id（会话归组稳定）", async () => {
  await withFakeUpstream([{ body: "[DONE]" }], async (captured) => {
    const impl = fetchImpl();
    const payload = {
      model: "qmodel",
      messages: [{ role: "system", content: "sys" }, { role: "user", content: "同一个开头" }],
    };
    await impl(openAiRequest(payload), {});
    await impl(openAiRequest(payload), {});
    const decode = (call) => JSON.parse(new TextDecoder().decode(decodeQoderBase64(call.init.body)));
    const [first, second] = captured.map(decode);
    assert.equal(first.business.id, second.business.id);
    assert.notEqual(first.request_id, second.request_id);
  });
});

test("信封里 statusCodeValue 非 200 时按失败返回，不伪装成空流", async () => {
  await withFakeUpstream([
    { body: JSON.stringify({ code: "101", message: "Signature invalid" }), statusCodeValue: 403 },
  ], async () => {
    const response = await fetchImpl()(openAiRequest({ model: "qmodel", messages: [{ role: "user", content: "hi" }] }), {});
    assert.equal(response.status, 502);
    const payload = await response.json();
    assert.match(payload.error.message, /statusCodeValue=403/);
    assert.match(payload.error.message, /Signature invalid/);
  });
});
