import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  buildMobileUrl,
  lanAddressRank,
  pickLanAddress,
  resolveMobilePairInfo,
} = await jiti.import("./mobile-pair.ts");

function iface(address, family = "IPv4", internal = false) {
  return { address, netmask: "255.255.255.0", family, mac: "00:00:00:00:00:00", internal, cidr: `${address}/24` };
}

const LAN = { en0: [iface("192.168.1.20")] };

test("ranks private LAN addresses above everything else", () => {
  assert.equal(lanAddressRank("192.168.1.20"), 0);
  assert.equal(lanAddressRank("10.0.0.7"), 1);
  assert.equal(lanAddressRank("172.16.4.9"), 2);
  assert.equal(lanAddressRank("100.101.102.103"), 3);
  assert.equal(lanAddressRank("8.8.8.8"), 4);
});

test("rejects loopback, link-local and non-IPv4 addresses", () => {
  assert.equal(lanAddressRank("127.0.0.1"), null);
  assert.equal(lanAddressRank("169.254.10.1"), null);
  assert.equal(lanAddressRank("::1"), null);
  assert.equal(lanAddressRank("fe80::1"), null);
});

test("picks the Wi-Fi address over a CGNAT tunnel", () => {
  const picked = pickLanAddress({
    utun3: [iface("100.101.102.103")],
    en0: [iface("192.168.1.20")],
    lo0: [iface("127.0.0.1", "IPv4", true)],
  });

  assert.equal(picked, "192.168.1.20");
});

test("falls back to any reachable IPv4 when no private address exists", () => {
  assert.equal(pickLanAddress({ en0: [iface("203.0.113.7")] }), "203.0.113.7");
  assert.equal(pickLanAddress({ lo0: [iface("127.0.0.1", "IPv4", true)] }), null);
});

test("builds the remote url with encoded session and cwd", () => {
  assert.equal(buildMobileUrl("http://192.168.1.20:30141"), "http://192.168.1.20:30141/m");
  assert.equal(buildMobileUrl("http://192.168.1.20:30141/", { session: "abc-123" }), "http://192.168.1.20:30141/m?session=abc-123");
  assert.equal(
    buildMobileUrl("http://192.168.1.20:30141", { session: "abc-123", cwd: "/Users/me/My Projects/pi desktop" }),
    "http://192.168.1.20:30141/m?session=abc-123&cwd=%2FUsers%2Fme%2FMy+Projects%2Fpi+desktop",
  );
});

test("uses the desktop proxy port when phone access is enabled", () => {
  const info = resolveMobilePairInfo({
    bindHost: "127.0.0.1",
    port: "49999",
    passwordRequired: true,
    desktopShell: true,
    interfaces: LAN,
    lanAccess: { enabled: true, lanPort: 30141 },
    session: "abc-123",
  });

  // 桌面壳里 Next 仍绑回环，二维码必须指向代理端口而不是请求端口。
  assert.equal(info.url, "http://192.168.1.20:30141/m?session=abc-123");
  assert.equal(info.host, "192.168.1.20");
  assert.equal(info.port, "30141");
  assert.equal(info.reason, "ok");
  assert.equal(info.lanEnabled, true);
});

test("waits for the proxy to report a port", () => {
  const info = resolveMobilePairInfo({
    bindHost: "127.0.0.1",
    port: "49999",
    passwordRequired: true,
    desktopShell: true,
    interfaces: LAN,
    lanAccess: { enabled: true, lanPort: null },
  });

  assert.equal(info.url, null);
  assert.equal(info.reason, "starting");
  assert.equal(info.lanEnabled, true);
});

test("points the desktop shell at the settings section when phone access is off", () => {
  const info = resolveMobilePairInfo({
    bindHost: "127.0.0.1",
    port: "49999",
    passwordRequired: false,
    desktopShell: true,
    interfaces: LAN,
    lanAccess: { enabled: false, lanPort: null },
  });

  assert.equal(info.url, null);
  assert.equal(info.reason, "lan-disabled");
  assert.equal(info.desktopShell, true);
});

test("keeps the cli hint when the server itself is bound to loopback", () => {
  const info = resolveMobilePairInfo({
    bindHost: "127.0.0.1",
    port: "30141",
    passwordRequired: false,
    desktopShell: false,
    interfaces: LAN,
  });

  assert.equal(info.url, null);
  assert.equal(info.reason, "loopback-only");
  assert.equal(info.lanEnabled, false);
});

test("still resolves a LAN url for a directly bound server", () => {
  const info = resolveMobilePairInfo({
    bindHost: "0.0.0.0",
    port: "30141",
    passwordRequired: true,
    desktopShell: false,
    interfaces: LAN,
    session: "abc-123",
    cwd: "/Users/me/pi-desktop",
  });

  assert.equal(info.url, "http://192.168.1.20:30141/m?session=abc-123&cwd=%2FUsers%2Fme%2Fpi-desktop");
  assert.equal(info.reason, "ok");
  assert.equal(info.passwordRequired, true);
});

test("uses an explicitly bound address as-is", () => {
  const info = resolveMobilePairInfo({
    bindHost: "192.168.50.9",
    port: "8080",
    passwordRequired: true,
    desktopShell: false,
    interfaces: { en0: [iface("10.0.0.5")] },
  });

  assert.equal(info.url, "http://192.168.50.9:8080/m");
});

test("flags a LAN bind that has no usable address", () => {
  const info = resolveMobilePairInfo({
    bindHost: "0.0.0.0",
    port: "30141",
    passwordRequired: true,
    desktopShell: false,
    interfaces: { lo0: [iface("127.0.0.1", "IPv4", true)] },
  });

  assert.equal(info.url, null);
  assert.equal(info.reason, "no-lan-address");
  assert.equal(info.lanEnabled, true);
});
