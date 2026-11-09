import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";
import { InMemoryCredentialStore, normalizeContext } from "@earendil-works/pi-ai";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createDesktopModelRuntime } = await jiti.import("../desktop-providers.ts");

/**
 * 端到端串起来：凭证 → getAuth → transport 改写请求 → COSY 头 → 信封解包 →
 * SDK 的 OpenAI 适配器解析。这条链路上任何一环断掉，界面里都会表现为
 * 「登录成功但发消息没反应」，所以用假的上游把整条链测出来。
 */
function envelope(body, statusCodeValue = 200) {
  return `data:${JSON.stringify({ headers: { "Content-Type": ["application/json"] }, body, statusCodeValue })}\n\n`;
}

async function withUpstream(t) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/api/v1/userinfo")) {
      return Response.json({ id: "u-1", name: "tester", user_type: "personal_pro" });
    }
    if (url.includes("/agent_chat_generation")) {
      const stream = envelope(JSON.stringify({
        id: "chatcmpl-1",
        choices: [{ index: 0, delta: { role: "assistant", content: "你好" } }],
      }))
        + envelope(JSON.stringify({
          id: "chatcmpl-1",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }))
        + envelope("[DONE]");
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    throw new Error(`unexpected upstream call: ${url}`);
  });
  return calls;
}

async function loggedInRuntime() {
  const credentials = new InMemoryCredentialStore();
  await credentials.modify("qoder-cn", async () => ({
    type: "oauth",
    access: "access-token-1",
    refresh: "drt-refresh-1",
    expires: Date.now() + 3_600_000,
    uid: "u-1",
    nickname: "tester",
    userType: "personal_pro",
  }));
  return createDesktopModelRuntime({ credentials, modelsPath: null });
}

test("未登录时 Qoder CN 的模型不可用（但目录仍可见）", async (t) => {
  await withUpstream(t);
  // 必须给空的内存凭证库：默认路径会读真实 ~/.pi/agent/auth.json，
  // 本机登录过 Qoder CN 时这条断言就不再成立（测试不能依赖开发者的账号状态）。
  const runtime = await createDesktopModelRuntime({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
  });
  assert.equal(runtime.getModels("qoder-cn").length, 15);
  assert.equal((await runtime.getAvailable("qoder-cn")).length, 0);
});

test("已登录时一次对话会走 COSY 改写后的 agent 端点并被解析成文本", async (t) => {
  const calls = await withUpstream(t);
  const runtime = await loggedInRuntime();
  const model = runtime.getModel("qoder-cn", "qmodel");
  assert.ok(model, "未注册 qmodel");
  assert.equal(runtime.isUsingOAuth("qoder-cn"), true);

  const context = {
    systemPrompt: "你是测试助手。",
    messages: [{ role: "user", content: "打个招呼", timestamp: 1 }],
  };
  const result = await runtime.streamSimple(model, normalizeContext(context)).result();

  assert.equal(result.stopReason, "stop");
  assert.equal(result.content.filter((part) => part.type === "text").map((part) => part.text).join(""), "你好");
  assert.equal(result.usage?.input, 3);

  const chat = calls.find((call) => call.url.includes("/agent_chat_generation"));
  assert.ok(chat, "请求没有走到 agent_chat_generation");
  assert.match(chat.url, /agent_chat_generation\?FetchKeys=llm_model_result/);
  const headers = new Headers(chat.init.headers);
  assert.match(headers.get("authorization"), /^Bearer COSY\./);
  assert.equal(headers.get("x-model-key"), "qmodel");
  assert.equal(headers.get("cosy-user"), "u-1");
});
