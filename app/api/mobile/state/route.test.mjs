import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { pickPendingUiRequest } = await jiti.import("./route.ts");

test("picks the blocking request the phone has to answer", () => {
  const request = { type: "extension_ui_request", id: "q1", method: "select", title: "要合并吗？", options: ["是", "否"] };

  assert.deepEqual(pickPendingUiRequest({ pendingUiRequests: [request] }), request);
});

test("ignores non-blocking extension chatter", () => {
  // notify / setStatus / setWidget 这些不是问题，不该在手机上弹卡片。
  const state = {
    pendingUiRequests: [
      { type: "extension_ui_request", id: "n1", method: "notify", message: "开始部署" },
      { type: "extension_ui_request", id: "s1", method: "setStatus", statusKey: "deploy" },
      { type: "extension_ui_request", id: "q2", method: "confirm", title: "继续？", message: "会重启服务" },
    ],
  };

  assert.equal(pickPendingUiRequest(state)?.id, "q2");
});

test("takes the first blocking request when several are queued", () => {
  // 桌面端一次也只弹一个；手机端跟着同一个顺序，答完一个再出下一个。
  const state = {
    pendingUiRequests: [
      { id: "a", method: "input", title: "分支名？" },
      { id: "b", method: "editor", title: "改文案" },
    ],
  };

  assert.equal(pickPendingUiRequest(state)?.id, "a");
});

test("returns null when nothing is waiting or the state is missing", () => {
  assert.equal(pickPendingUiRequest(null), null);
  assert.equal(pickPendingUiRequest({}), null);
  assert.equal(pickPendingUiRequest({ pendingUiRequests: [] }), null);
  assert.equal(pickPendingUiRequest({ pendingUiRequests: [null, 42, { method: "select" }] }), null);
});
