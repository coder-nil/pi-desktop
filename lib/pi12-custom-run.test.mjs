import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";

test("Pi 1.2 custom runs pass the before_agent_start union safely", async () => {
  const faux = fauxProvider({
    provider: "pi12-custom-test",
    models: [{ id: "model" }],
  });
  faux.setResponses([fauxAssistantMessage("custom response")]);

  const modelRuntime = await ModelRuntime.create({ modelsPath: null });
  modelRuntime.registerProvider("pi12-custom-test", {
    api: faux.api,
    models: faux.models,
    streamSimple: faux.provider.streamSimple,
  });

  const events = [];
  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: process.env.HOME ? `${process.env.HOME}/.pi/agent` : undefined,
    noExtensions: true,
    extensionFactories: [
      (pi) => {
        pi.on("before_agent_start", (event) => {
          events.push({ messageType: event.messageType, systemPrompt: event.systemPrompt });
        });
      },
    ],
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    modelRuntime,
    model: modelRuntime.getModel("pi12-custom-test", "model"),
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory(),
  });

  try {
    await session.sendCustomMessage({
      customType: "pi12-test",
      content: [{ type: "text", text: "custom input" }],
      display: true,
    }, { triggerTurn: true });

    assert.deepEqual(events.map((event) => event.messageType), ["custom"]);
    assert.equal(typeof events[0].systemPrompt, "string");
    assert.equal(session.state.messages.at(-1)?.role, "assistant");
  } finally {
    session.dispose();
  }
});
