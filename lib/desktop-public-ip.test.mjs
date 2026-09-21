import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  desktopEgressIps,
  parseTraceIp,
  peekDesktopEgressIps,
  resetDesktopEgressCache,
  warmDesktopEgressIps,
} = await jiti.import("./desktop-public-ip.ts");

function traceResponse(ip) {
  return {
    ok: true,
    text: async () => `fl=123abc\nh=cloudflare.com\nip=${ip}\nts=1758400000\n`,
  };
}

test("parses the ip field out of a trace response", () => {
  assert.equal(parseTraceIp("fl=1\nip=223.166.186.233\nts=1\n"), "223.166.186.233");
  assert.equal(parseTraceIp("fl=1\nip=2400:8d60:9::1\n"), "2400:8d60:9::1");
  // 只有一行 ip= 才认；其它键里的 ip 字样不认
  assert.equal(parseTraceIp("h=cloudflare.com\nwarp=off\n"), null);
  assert.equal(parseTraceIp("ip=\n"), null);
  assert.equal(parseTraceIp(""), null);
});

test("caches successful lookups", async () => {
  resetDesktopEgressCache();
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return traceResponse(url.includes("[") ? "2400:8d60:9::1" : "223.166.186.233");
  };

  const first = await desktopEgressIps({ fetchImpl, now: 1_000 });
  assert.deepEqual(first, ["223.166.186.233", "2400:8d60:9::1"]);
  const callsAfterFirst = seen.length;

  // 缓存有效期内不再打网络
  const second = await desktopEgressIps({ fetchImpl, now: 2_000 });
  assert.deepEqual(second, ["223.166.186.233", "2400:8d60:9::1"]);
  assert.equal(seen.length, callsAfterFirst);

  // 预热（后台刷新）：预热完就能直接用，不必等到下一次取值
  resetDesktopEgressCache();
  warmDesktopEgressIps({ fetchImpl, now: 5_000 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(peekDesktopEgressIps(), ["223.166.186.233", "2400:8d60:9::1"]);
});

test("never blocks the page when lookup is slow or fails", async () => {
  resetDesktopEgressCache();
  // 永远不返回的 fetch：maxWaitMs=0 时必须立刻返回空值，而不是挂住页面
  const hanging = () => new Promise(() => {});
  const started = Date.now();
  assert.deepEqual(await desktopEgressIps({ fetchImpl: hanging, now: 1, maxWaitMs: 0 }), []);
  assert.ok(Date.now() - started < 500, "不该等待");

  resetDesktopEgressCache();
  const failing = async () => ({ ok: false, text: async () => "" });
  assert.deepEqual(await desktopEgressIps({ fetchImpl: failing, now: 1 }), []);
  assert.deepEqual(peekDesktopEgressIps(), []);
});

test("keeps the previous value while refreshing in the background", async () => {
  resetDesktopEgressCache();
  const base = Date.now();
  await desktopEgressIps({ fetchImpl: async () => traceResponse("223.166.186.233"), now: base });
  assert.deepEqual(peekDesktopEgressIps(), ["223.166.186.233"]);

  // 缓存过期：冷取值不能让页面等，先给旧值（旧值也比没有强），后台去刷新。
  const expired = base + 6 * 60 * 1000;
  const slow = () =>
    new Promise((resolve) => setTimeout(() => resolve(traceResponse("198.51.100.7")), 80));
  assert.deepEqual(
    await desktopEgressIps({ fetchImpl: slow, now: expired, maxWaitMs: 0 }),
    ["223.166.186.233"],
  );

  // 刷新完成后取到的就是新值。
  assert.deepEqual(await desktopEgressIps({ fetchImpl: slow, now: expired + 200 }), ["198.51.100.7"]);
});
