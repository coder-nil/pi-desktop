import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeInner() {
  const inner = {
    isBashRunning: false,
    isStreaming: false,
    isCompacting: false,
    extensionRunner: {},
    sessionManager: { getCwd: () => "/tmp" },
    settingsManager: { setProjectTrusted: () => {}, applyOverrides: () => {} },
    agent: { state: {}, streamFunction: () => {} },
    getContextUsage: () => null,
    getSteeringMessages: () => [],
    getFollowUpMessages: () => [],
    resourceLoader: { getSkills: () => ({ skills: [] }) },
    reload: async () => {},
    abortCalls: 0,
    abort: async () => {
      inner.abortCalls += 1;
      if (inner.isStreaming) inner.isStreaming = false;
    },
    dispose() {},
  };
  return inner;
}

test("abort during a prompt's preparation still cancels the run it starts", async (t) => {
  const inner = makeInner();
  let runStarted = false;
  inner.prompt = async (_message, options) => {
    // 准备阶段：资源重载 / 扩展 preflight 还没让这一轮开跑，
    // 此时 AgentSession.abort() 是空操作。
    await sleep(150);
    options.preflightResult("started");
    inner.isStreaming = true;
    runStarted = true;
    // 这一轮会一直“输出”到被中止为止。
    for (let tick = 0; tick < 100 && inner.isStreaming; tick++) await sleep(20);
  };

  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());

  const promptPromise = wrapper.send({ type: "prompt", message: "hi" });
  await sleep(40);
  assert.equal(runStarted, false, "prompt 应该还在准备阶段");

  const startedAt = Date.now();
  await wrapper.send({ type: "abort" });
  await promptPromise;

  assert.ok(runStarted, "这一轮还是开始了（准备阶段本来就拦不住）");
  assert.equal(inner.isStreaming, false, "一开始跑就必须被中止");
  assert.ok(inner.abortCalls >= 2, "准备阶段那一次 abort 之外还要再取消一次");
  assert.ok(Date.now() - startedAt < 2000, "不应该等这一轮自然结束");
});

test("abort on an idle session resolves after a single attempt", async (t) => {
  const inner = makeInner();
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());

  const startedAt = Date.now();
  await wrapper.send({ type: "abort" });

  assert.equal(inner.abortCalls, 1);
  assert.ok(Date.now() - startedAt < 500, "空闲时停止必须立刻返回");
});
