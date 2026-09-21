import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  discoverTunnelHostname,
  findTunnelHostname,
  findTunnelId,
  parseOriginToken,
  resetTunnelHostnameCache,
} = await jiti.import("./tunnel-discovery.ts");

const TUNNEL_ID = "8e9d19b6-ec44-46a2-93ae-830b6e4d3829";

function originCert(overrides = {}) {
  const payload = { zoneID: "zone123", accountID: "acct456", apiToken: "tok789", ...overrides };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `-----BEGIN ARGO TUNNEL TOKEN-----\n${body}\n-----END ARGO TUNNEL TOKEN-----\n`;
}

async function withDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "pi-tunnel-discovery-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("parses the login certificate into an API token", () => {
  assert.deepEqual(parseOriginToken(originCert()), {
    zoneID: "zone123",
    accountID: "acct456",
    apiToken: "tok789",
  });
  // 少了字段就不是能用的凭据
  assert.equal(parseOriginToken(originCert({ apiToken: undefined })), null);
  assert.equal(parseOriginToken("-----BEGIN X-----\nbm90LWpzb24=\n-----END X-----"), null);
  assert.equal(parseOriginToken(""), null);
});

test("finds the tunnel id from the credentials file name", async (t) => {
  const directory = await withDirectory(t);
  await writeFile(join(directory, `${TUNNEL_ID}.json`), "{}");
  assert.equal(findTunnelId(directory), TUNNEL_ID);

  // 不是凭据的文件不能被误当隧道 id
  const other = await withDirectory(t);
  await writeFile(join(other, "cert.pem"), "x");
  await writeFile(join(other, "notes.json"), "{}");
  assert.equal(findTunnelId(other), null);
  assert.equal(findTunnelId(join(other, "missing-directory")), null);
});

test("picks the CNAME that points at this tunnel", () => {
  const records = [
    { type: "A", name: "π.works", content: "1.2.3.4" },
    { type: "CNAME", name: "xn--1xa.works.", content: `${TUNNEL_ID}.cfargotunnel.com` },
    { type: "CNAME", name: "other.example.com", content: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.cfargotunnel.com" },
    { type: "MX", name: "π.works", content: "mx1.spacemail.com" },
  ];
  assert.equal(findTunnelHostname(records, TUNNEL_ID), "xn--1xa.works");
  // 没有指向本隧道的记录 → 不猜
  assert.equal(findTunnelHostname(records, "11111111-2222-3333-4444-555555555555"), null);
  assert.equal(findTunnelHostname(null, TUNNEL_ID), null);
  assert.equal(findTunnelHostname([], TUNNEL_ID), null);
});

test("discovers the hostname through the Cloudflare API and caches it", async (t) => {
  const directory = await withDirectory(t);
  await writeFile(join(directory, "cert.pem"), originCert());
  await writeFile(join(directory, `${TUNNEL_ID}.json`), "{}");
  resetTunnelHostnameCache();

  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init?.headers?.Authorization });
    return {
      ok: true,
      json: async () => ({
        result: [
          { type: "MX", name: "π.works", content: "mx1.spacemail.com" },
          { type: "CNAME", name: "xn--1xa.works.", content: `${TUNNEL_ID}.cfargotunnel.com` },
        ],
      }),
    };
  };

  assert.equal(await discoverTunnelHostname({ directory, fetchImpl, now: 1_000 }), "xn--1xa.works");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /zones\/zone123\/dns_records/);
  assert.equal(calls[0].auth, "Bearer tok789");

  // 命中缓存：不再打接口（设置页轮询期间不该反复调 Cloudflare）
  assert.equal(await discoverTunnelHostname({ directory, fetchImpl, now: 2_000 }), "xn--1xa.works");
  assert.equal(calls.length, 1);
});

test("returns null instead of throwing when discovery cannot work", async (t) => {
  resetTunnelHostnameCache();
  const empty = await withDirectory(t);
  // 没登录过（没有 cert.pem）：一个请求都不发
  let called = 0;
  const countingFetch = async () => { called += 1; return { ok: false, json: async () => ({}) }; };
  assert.equal(await discoverTunnelHostname({ directory: empty, fetchImpl: countingFetch, now: 1 }), null);
  assert.equal(called, 0);

  const directory = await withDirectory(t);
  await writeFile(join(directory, "cert.pem"), originCert());
  await writeFile(join(directory, `${TUNNEL_ID}.json`), "{}");
  resetTunnelHostnameCache();

  // 接口报错 / 网络异常都只是「发现不到」，并且失败也要短缓存，避免刷接口
  const failing = async () => { called += 1; throw new Error("boom"); };
  assert.equal(await discoverTunnelHostname({ directory, fetchImpl: failing, now: 1 }), null);
  assert.equal(await discoverTunnelHostname({ directory, fetchImpl: failing, now: 2 }), null);
  assert.equal(called, 1);
});
