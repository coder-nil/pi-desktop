import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createJiti } from "jiti";

// 仓库约定：测试用 jiti 加载 TS（见 lib/desktop-providers.test.mjs），
// 这样被测模块可以继续用 Next 的无扩展名相对导入。
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createCosySession, signaturePath, sortedCompactJson } = await jiti.import("./cosy.ts");
const { deriveDeviceId, deriveMachineToken, deriveMachineType } = await jiti.import("./fingerprint.ts");

const IDENTITY = {
  uid: "u-1234567890",
  nickname: "tester",
  accessToken: "drt-access-token",
  refreshToken: "drt-refresh-token",
  userType: "personal_pro",
  organizationId: "org-1",
  organizationName: "Acme",
};

test("sortedCompactJson 按键排序且无空白", () => {
  assert.equal(sortedCompactJson({ b: "2", a: "1" }).toString("utf8"), '{"a":"1","b":"2"}');
});

test("signaturePath 去掉 /algo 前缀", () => {
  assert.equal(
    signaturePath("https://gateway.qoder.com.cn/algo/api/v2/service/pro/sse/agent_chat_generation?Encode=1"),
    "/api/v2/service/pro/sse/agent_chat_generation",
  );
  assert.equal(signaturePath("https://gateway.qoder.com.cn/api/v1/userinfo"), "/api/v1/userinfo");
});

test("设备指纹按账号稳定派生：同 uid 恒定、跨 uid 不同", () => {
  assert.equal(deriveDeviceId("u1", "machine"), deriveDeviceId("u1", "machine"));
  assert.notEqual(deriveDeviceId("u1", "machine"), deriveDeviceId("u2", "machine"));
  // UUIDv4 形态：第 13 位固定 4、第 17 位固定 a（与官方 machineId 同形）。
  assert.match(deriveDeviceId("u1", "machine"), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(deriveMachineType("u1").length, 18);
  assert.equal(deriveMachineToken("u1").length, 43);
});

test("COSY 头齐全，且签名可被逐字节复算", () => {
  const session = createCosySession(IDENTITY);
  const body = "encoded-body";
  const rawUrl = "https://gateway.qoder.com.cn/algo/api/v2/service/pro/sse/agent_chat_generation?Encode=1";
  const headers = session.headers(body, rawUrl, { modelKey: "qmodel", sse: true });

  for (const key of [
    "cosy-data-policy", "cosy-business-product", "cosy-business-type", "cosy-scene",
    "cosy-clienttype", "cosy-date", "cosy-user", "cosy-key", "authorization",
    "cosy-version", "cosy-machineid", "cosy-machinetoken", "cosy-machinetype",
    "cosy-machineos", "cosy-clientip", "login-version",
  ]) {
    assert.ok(headers[key], `missing header ${key}`);
  }
  assert.equal(headers["cosy-user"], IDENTITY.uid);
  assert.equal(headers["x-model-key"], "qmodel");
  assert.equal(headers["x-model-source"], "system");
  assert.equal(headers["accept"], "text/event-stream");
  // hostname / cache-control 只出现在 SSE 场景。
  assert.ok(headers["cosy-machinehostname"]);
  assert.equal(headers["cache-control"], "no-cache");

  const match = /^Bearer COSY\.(.+)\.([0-9a-f]{32})$/.exec(headers.authorization);
  assert.ok(match, "authorization 必须是 Bearer COSY.<payload>.<md5>");
  const [, payload, signature] = match;
  const expected = createHash("md5")
    .update([payload, headers["cosy-key"], headers["cosy-date"], body, signaturePath(rawUrl)].join("\n"))
    .digest("hex");
  assert.equal(signature, expected);
});

test("非 SSE 请求不带 machinehostname，但保留 machineos", () => {
  const session = createCosySession(IDENTITY);
  const headers = session.headers("{}", "https://gateway.qoder.com.cn/algo/api/v2/model/list?Encode=1", {
    sse: false,
    accept: "application/json",
  });
  assert.equal(headers["cosy-machinehostname"], undefined);
  assert.equal(headers["cache-control"], undefined);
  assert.notEqual(headers["cosy-machineos"], undefined);
  assert.equal(headers["x-model-key"], undefined);
  assert.equal(headers["accept"], "application/json");
});

test("空 access token 直接拒绝，避免发出注定被拒的请求", () => {
  assert.throws(() => createCosySession({ uid: "u1", accessToken: "" }), /empty access token/);
});
