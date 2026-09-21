import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  clientIpFromHeaders,
  isPrivateAddress,
  normalizeAddress,
  resolveMobileRoute,
  sameNetwork,
} = await jiti.import("./mobile-route.ts");

const LAN_URL = "http://192.168.1.5:50169/m?session=abc";

function headers(values) {
  return (name) => values[name] ?? null;
}

test("recognizes private and public addresses", () => {
  for (const address of [
    "10.0.0.7",
    "172.16.3.4",
    "172.31.255.254",
    "192.168.1.5",
    "169.254.1.1",
    "100.64.0.9", // CGNAT
    "127.0.0.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:192.168.1.5",
  ]) {
    assert.equal(isPrivateAddress(address), true, address);
  }

  for (const address of ["8.8.8.8", "223.166.186.233", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111"]) {
    assert.equal(isPrivateAddress(address), false, address);
  }
});

test("compares addresses by network", () => {
  // 同一个 /24 视为同网（同一个运营商 NAT 池常见的形态）
  assert.equal(sameNetwork("223.166.186.10", "223.166.186.233"), true);
  assert.equal(sameNetwork("223.166.186.10", "223.166.187.2"), false);
  // exact 模式：必须完全相等
  assert.equal(sameNetwork("223.166.186.10", "223.166.187.2", "exact"), false);
  assert.equal(sameNetwork("1.2.3.4", "1.2.3.4", "exact"), true);
  // IPv6 按 /64
  assert.equal(sameNetwork("2400:8d60:9:1234::1", "2400:8d60:9:1234::ffff"), true);
  assert.equal(sameNetwork("2400:8d60:9:1234::1", "2400:8d60:a:1::1"), false);
  // 跨协议族不猜
  assert.equal(sameNetwork("1.2.3.4", "2606:4700::1"), false);
  assert.equal(sameNetwork("::ffff:1.2.3.4", "1.2.3.9"), true);
});

test("reads the client address from the headers it trusts", () => {
  assert.equal(clientIpFromHeaders(headers({ "cf-connecting-ip": "223.166.186.233" })), "223.166.186.233");
  assert.equal(clientIpFromHeaders(headers({ "cf-connecting-ip": "::ffff:192.168.1.5" })), "192.168.1.5");
  assert.equal(clientIpFromHeaders(headers({ "x-pi-client-ip": "192.168.1.5" })), "192.168.1.5");
  assert.equal(clientIpFromHeaders(headers({ "x-real-ip": "203.0.113.9" })), "203.0.113.9");
  assert.equal(clientIpFromHeaders(headers({})), null);
  assert.equal(clientIpFromHeaders(headers({ "cf-connecting-ip": "   " })), null);
});

test("stays on the public entry whenever the answer is unclear", () => {
  const base = { clientIp: "9.9.9.9", desktopIps: ["1.2.3.4"], lanUrl: LAN_URL, alreadyLocal: false };
  // 拿不到客户端 IP
  assert.deepEqual(
    resolveMobileRoute({ ...base, clientIp: null }),
    { route: "public", redirectTo: null },
  );
  // 局域网没开 / 没有局域网地址
  assert.deepEqual(
    resolveMobileRoute({ ...base, lanUrl: null }),
    { route: "public", redirectTo: null },
  );
  // 出口 IP 不一样
  assert.deepEqual(resolveMobileRoute(base), { route: "public", redirectTo: null });
  // 桌面自己的出口 IP 还没查到
  assert.deepEqual(
    resolveMobileRoute({ ...base, clientIp: "1.2.3.9", desktopIps: [] }),
    { route: "public", redirectTo: null },
  );
});

test("switches to the LAN when both sides share the egress network", () => {
  assert.deepEqual(
    resolveMobileRoute({
      clientIp: "223.166.186.10",
      desktopIps: ["223.166.186.233"],
      lanUrl: LAN_URL,
      alreadyLocal: false,
    }),
    { route: "lan", redirectTo: LAN_URL },
  );
  assert.deepEqual(
    resolveMobileRoute({
      clientIp: "2400:8d60:9:1234::1",
      desktopIps: ["2400:8d60:9:1234::9"],
      lanUrl: LAN_URL,
      alreadyLocal: false,
    }),
    { route: "lan", redirectTo: LAN_URL },
  );
  // exact 模式：同段但不相等 → 不切（追求零误判时用）
  assert.deepEqual(
    resolveMobileRoute({
      clientIp: "223.166.186.10",
      desktopIps: ["223.166.186.233"],
      lanUrl: LAN_URL,
      alreadyLocal: false,
      mode: "exact",
    }),
    { route: "public", redirectTo: null },
  );
});

test("never bounces a request that is already local", () => {
  // 请求就是从内网来的（手机直连局域网地址）：留在局域网，不再跳
  assert.deepEqual(
    resolveMobileRoute({ clientIp: "192.168.1.5", desktopIps: [], lanUrl: LAN_URL, alreadyLocal: false }),
    { route: "lan", redirectTo: null },
  );
  // 用户按返回键回来并选了「用外网继续」：不再跳
  assert.deepEqual(
    resolveMobileRoute({
      clientIp: "223.166.186.10",
      desktopIps: ["223.166.186.233"],
      lanUrl: LAN_URL,
      alreadyLocal: true,
    }),
    { route: "lan", redirectTo: null },
  );
});

test("normalizes mapped addresses", () => {
  assert.equal(normalizeAddress("::FFFF:192.168.1.5"), "192.168.1.5");
  assert.equal(normalizeAddress("  192.168.1.5 "), "192.168.1.5");
});
