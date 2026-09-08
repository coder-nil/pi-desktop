import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { stream } from "../node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createDesktopModelRuntime } = await jiti.import("./desktop-providers.ts");

test("registers Coding as a built-in API-key provider", async () => {
  const runtime = await createDesktopModelRuntime({ modelsPath: null });
  const provider = runtime.getProvider("apisets");
  const config = runtime.getRegisteredProviderConfig("apisets");

  assert.equal(provider?.name, "Coding");
  assert.equal(provider?.baseUrl, "https://coding.apisets.com");
  assert.equal(config?.api, "anthropic-messages");
  assert.equal(Boolean(provider?.auth.apiKey?.login), true);
  assert.equal(provider?.auth.oauth, undefined);
});

test("Coding GLM replays unsigned thinking separately from assistant text", async (t) => {
  const runtime = await createDesktopModelRuntime({ modelsPath: null });
  const config = runtime.getRegisteredProviderConfig("apisets");
  t.mock.method(globalThis, "fetch", async () => Response.json({
    data: [{ id: "glm-5.3" }, { id: "another-model" }],
  }));
  const models = await config.refreshModels({ credential: { type: "api_key", key: "test" } });
  assert.equal(models.find((model) => model.id === "another-model").compat, undefined);
  const model = {
    ...models.find((model) => model.id === "glm-5.3"),
    provider: "apisets",
    api: config.api,
    baseUrl: "https://example.invalid",
  };
  const context = {
    systemPrompt: "请始终使用简体中文回复。",
    messages: [
      { role: "user", content: "请检查文件", timestamp: 1 },
      {
        role: "assistant", provider: model.provider, api: model.api, model: model.id,
        content: [
          { type: "thinking", thinking: "Let me inspect the file." },
          { type: "text", text: "我先检查文件。" },
          { type: "toolCall", id: "call1", name: "read", arguments: { path: "a.ts" } },
        ],
        stopReason: "toolUse", timestamp: 2,
      },
      {
        role: "toolResult", toolCallId: "call1", toolName: "read",
        content: [{ type: "text", text: "export const a = 1;" }], isError: false, timestamp: 3,
      },
    ],
  };
  const original = structuredClone(context);
  let payload;
  await stream(model, context, {
    apiKey: "test",
    onPayload(value) {
      payload = value;
      throw new Error("Captured before network request");
    },
    fetch() { throw new Error("Unexpected network request"); },
  }).result();
  assert.equal(payload.system[0].text, context.systemPrompt);
  assert.deepEqual(payload.messages[1].content, [
    { type: "thinking", thinking: "Let me inspect the file.", signature: "" },
    { type: "text", text: "我先检查文件。" },
    { type: "tool_use", id: "call1", name: "read", input: { path: "a.ts" } },
  ]);
  assert.equal(payload.messages[2].content[0].type, "tool_result");
  assert.deepEqual(context, original);
});
