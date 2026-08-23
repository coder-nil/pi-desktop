import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createJiti } from "jiti";

const { proxy } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../proxy.ts");

function request(host, authorization) {
  return new NextRequest("http://localhost:30141/api/sessions", {
    headers: {
      host,
      ...(authorization ? { authorization } : {}),
    },
  });
}

function basicAuth(password) {
  return `Basic ${Buffer.from(`pi:${password}`, "utf8").toString("base64")}`;
}

test("refuses non-loopback access when authentication is disabled", () => {
  const originalPassword = process.env.PI_WEB_PASSWORD;
  const originalHostname = process.env.PI_WEB_HOSTNAME;
  delete process.env.PI_WEB_PASSWORD;
  process.env.PI_WEB_HOSTNAME = "127.0.0.1";
  try {
    assert.equal(proxy(request("192.168.1.9:30141")).status, 403);
    assert.equal(proxy(request("127.0.0.1:30141")).status, 200);

    process.env.PI_WEB_HOSTNAME = "0.0.0.0";
    assert.equal(proxy(request("localhost:30141")).status, 403);
  } finally {
    if (originalPassword === undefined) delete process.env.PI_WEB_PASSWORD;
    else process.env.PI_WEB_PASSWORD = originalPassword;
    if (originalHostname === undefined) delete process.env.PI_WEB_HOSTNAME;
    else process.env.PI_WEB_HOSTNAME = originalHostname;
  }
});

test("allows authenticated non-loopback access", () => {
  const originalPassword = process.env.PI_WEB_PASSWORD;
  const originalHostname = process.env.PI_WEB_HOSTNAME;
  process.env.PI_WEB_PASSWORD = "long-random-password";
  process.env.PI_WEB_HOSTNAME = "0.0.0.0";
  try {
    assert.equal(proxy(request(
      "192.168.1.9:30141",
      basicAuth("long-random-password"),
    )).status, 200);
    assert.equal(proxy(request("192.168.1.9:30141", basicAuth("wrong"))).status, 401);
  } finally {
    if (originalPassword === undefined) delete process.env.PI_WEB_PASSWORD;
    else process.env.PI_WEB_PASSWORD = originalPassword;
    if (originalHostname === undefined) delete process.env.PI_WEB_HOSTNAME;
    else process.env.PI_WEB_HOSTNAME = originalHostname;
  }
});

test("throttles repeated failed authentication attempts", () => {
  const originalPassword = process.env.PI_WEB_PASSWORD;
  const originalHostname = process.env.PI_WEB_HOSTNAME;
  process.env.PI_WEB_PASSWORD = "long-random-password";
  process.env.PI_WEB_HOSTNAME = "0.0.0.0";
  globalThis.__piFailedWebAuthAttempts = [];
  try {
    for (let index = 0; index < 20; index += 1) {
      assert.equal(proxy(request("192.168.1.9:30141", basicAuth(`wrong-${index}`))).status, 401);
    }
    const response = proxy(request("192.168.1.9:30141", basicAuth("wrong-again")));
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "60");
  } finally {
    globalThis.__piFailedWebAuthAttempts = [];
    if (originalPassword === undefined) delete process.env.PI_WEB_PASSWORD;
    else process.env.PI_WEB_PASSWORD = originalPassword;
    if (originalHostname === undefined) delete process.env.PI_WEB_HOSTNAME;
    else process.env.PI_WEB_HOSTNAME = originalHostname;
  }
});
