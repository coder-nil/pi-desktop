import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  MIN_DESKTOP_ACCESS_PASSWORD_LENGTH,
  displayHostname,
  normalizeAccessHostname,
  readDesktopLanAccess,
  readDesktopLanRuntime,
  readDesktopTunnelRuntime,
  validateDesktopAccessPassword,
  writeDesktopLanAccess,
} = await jiti.import("./desktop-access.ts");

const NO_PUBLIC = { enabled: false, mode: "quick", hostname: null };

async function withDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "pi-desktop-lan-access-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("round-trips the phone access config with owner-only permissions", async (t) => {
  const directory = await withDirectory(t);
  const configPath = join(directory, "desktop-access.json");

  assert.deepEqual(readDesktopLanAccess(configPath), { enabled: false, password: null, public: NO_PUBLIC });

  writeDesktopLanAccess(
    { enabled: true, password: "long-enough-secret", public: NO_PUBLIC },
    configPath,
  );

  assert.deepEqual(readDesktopLanAccess(configPath), {
    enabled: true,
    password: "long-enough-secret",
    public: NO_PUBLIC,
  });
  assert.equal(statSync(configPath).mode & 0o777, 0o600);
});

test("never reports enabled without a password", async (t) => {
  const directory = await withDirectory(t);
  const configPath = join(directory, "desktop-access.json");

  // 直接写文件（模拟手工改坏或旧版本写入的内容）。
  await writeFile(configPath, JSON.stringify({ enabled: true, password: "" }), "utf-8");
  assert.equal(readDesktopLanAccess(configPath).enabled, false);

  writeDesktopLanAccess({ enabled: true, password: null, public: NO_PUBLIC }, configPath);
  assert.equal(readDesktopLanAccess(configPath).enabled, false);

  await writeFile(configPath, "not json", "utf-8");
  assert.deepEqual(readDesktopLanAccess(configPath), { enabled: false, password: null, public: NO_PUBLIC });
});

test("reads the proxy runtime port written by the desktop shell", async (t) => {
  const directory = await withDirectory(t);
  const runtimePath = join(directory, "desktop-access.runtime.json");

  assert.deepEqual(readDesktopLanRuntime(runtimePath), { lanPort: null });

  await writeFile(runtimePath, JSON.stringify({ lanPort: 30141 }), "utf-8");
  assert.deepEqual(readDesktopLanRuntime(runtimePath), { lanPort: 30141 });

  // 垃圾值一律当作「还没起来」，避免二维码指向一个不存在的端口。
  await writeFile(runtimePath, JSON.stringify({ lanPort: "30141" }), "utf-8");
  assert.deepEqual(readDesktopLanRuntime(runtimePath), { lanPort: null });
  await writeFile(runtimePath, JSON.stringify({ lanPort: 0 }), "utf-8");
  assert.deepEqual(readDesktopLanRuntime(runtimePath), { lanPort: null });
});

test("ignores a runtime port written by a previous shell process", async (t) => {
  const directory = await withDirectory(t);
  const runtimePath = join(directory, "desktop-access.runtime.json");
  const previous = process.env.PI_WEB_SHELL_PID;
  try {
    process.env.PI_WEB_SHELL_PID = "4242";
    // 上一轮进程写下的端口：重启后它可能已经属于别的进程（例如 Next dev server），
    // 拿来当局域网入口会让手机连到一个不认这个协议的端口。
    await writeFile(runtimePath, JSON.stringify({ lanPort: 53102, listening: true, ownerPid: 999999 }), "utf-8");
    assert.deepEqual(readDesktopLanRuntime(runtimePath), { lanPort: null });

    await writeFile(runtimePath, JSON.stringify({ lanPort: 53102, listening: true, ownerPid: 4242 }), "utf-8");
    assert.deepEqual(readDesktopLanRuntime(runtimePath), { lanPort: 53102 });

    // 命令行启动时没有这个环境变量：保持旧行为。
    delete process.env.PI_WEB_SHELL_PID;
    assert.deepEqual(readDesktopLanRuntime(runtimePath), { lanPort: 53102 });
  } finally {
    if (previous === undefined) delete process.env.PI_WEB_SHELL_PID;
    else process.env.PI_WEB_SHELL_PID = previous;
  }
});

test("requires a password of at least the minimum length", () => {
  const short = "a".repeat(MIN_DESKTOP_ACCESS_PASSWORD_LENGTH - 1);
  const ok = "a".repeat(MIN_DESKTOP_ACCESS_PASSWORD_LENGTH);

  assert.deepEqual(validateDesktopAccessPassword(short), { ok: false, error: "too-short" });
  assert.deepEqual(validateDesktopAccessPassword("   "), { ok: false, error: "too-short" });
  assert.deepEqual(validateDesktopAccessPassword(undefined), { ok: false, error: "too-short" });
  assert.deepEqual(validateDesktopAccessPassword(`  ${ok}  `), { ok: true, value: ok });
});

test("the config file stays readable for the desktop shell", async (t) => {
  const directory = await withDirectory(t);
  const configPath = join(directory, "desktop-access.json");

  writeDesktopLanAccess(
    { enabled: true, password: "long-enough-secret", public: NO_PUBLIC },
    configPath,
  );

  const raw = JSON.parse(await readFile(configPath, "utf-8"));
  assert.deepEqual(raw, {
    enabled: true,
    password: "long-enough-secret",
    public: NO_PUBLIC,
  });
});

test("normalizes hostnames to punycode", () => {
  // 界面输入 Unicode，落盘必须是 punycode：CF 的 Host 头与 Rust 侧的校验都用它。
  assert.equal(normalizeAccessHostname("π.works"), "xn--1xa.works");
  assert.equal(normalizeAccessHostname("  Example.COM  "), "example.com");
  assert.equal(normalizeAccessHostname("π.works"), "xn--1xa.works");
  assert.equal(displayHostname("xn--1xa.works"), "π.works");

  assert.equal(normalizeAccessHostname(""), null);
  assert.equal(normalizeAccessHostname("localhost"), null);
  assert.equal(normalizeAccessHostname("not a domain"), null);
  assert.equal(normalizeAccessHostname("-bad.example.com"), null);
  assert.equal(normalizeAccessHostname(undefined), null);
  assert.equal(displayHostname(null), null);
});

test("stores the public tunnel settings as punycode", async (t) => {
  const directory = await withDirectory(t);
  const configPath = join(directory, "desktop-access.json");

  writeDesktopLanAccess(
    {
      enabled: true,
      password: "long-enough-secret",
      public: { enabled: true, mode: "named", hostname: "π.works" },
    },
    configPath,
  );

  assert.deepEqual(readDesktopLanAccess(configPath).public, {
    enabled: true,
    mode: "named",
    hostname: "xn--1xa.works",
  });
});

test("refuses to enable the named tunnel without a usable hostname", async (t) => {
  const directory = await withDirectory(t);
  const configPath = join(directory, "desktop-access.json");

  // 手工改坏的配置：named 但没有域名 —— 起隧道只会 404，所以按「未启用」处理。
  await writeFile(
    configPath,
    JSON.stringify({ enabled: true, password: "x".repeat(12), public: { enabled: true, mode: "named" } }),
    "utf-8",
  );
  assert.equal(readDesktopLanAccess(configPath).public.enabled, false);

  // quick 模式不需要域名。
  await writeFile(
    configPath,
    JSON.stringify({ enabled: true, password: "x".repeat(12), public: { enabled: true, mode: "quick" } }),
    "utf-8",
  );
  const quick = readDesktopLanAccess(configPath).public;
  assert.equal(quick.enabled, true);
  assert.equal(quick.mode, "quick");
});

test("reads the tunnel runtime written by the desktop shell", async (t) => {
  const directory = await withDirectory(t);
  const runtimePath = join(directory, "desktop-access.tunnel.json");

  // 从没开过：默认就是关闭态。
  assert.deepEqual(readDesktopTunnelRuntime(runtimePath), {
    state: "disabled",
    mode: "quick",
    url: null,
    hostname: null,
    pid: null,
    restarts: 0,
    lastError: null,
    logTail: [],
    updatedAtMs: null,
  });

  await writeFile(runtimePath, JSON.stringify({
    state: "running",
    mode: "quick",
    url: "https://sample-tunnel.trycloudflare.com",
    pid: 12345,
    restarts: 1,
    lastError: null,
    logTail: ["INF Registered tunnel connection", 42],
    updatedAtMs: 1750000000000,
  }), "utf-8");

  const running = readDesktopTunnelRuntime(runtimePath);
  assert.equal(running.state, "running");
  assert.equal(running.url, "https://sample-tunnel.trycloudflare.com");
  assert.equal(running.pid, 12345);
  assert.equal(running.restarts, 1);
  // 非字符串的日志行被过滤掉，避免把 JSON 当成界面文案渲染。
  assert.deepEqual(running.logTail, ["INF Registered tunnel connection"]);

  // 未知状态不能原样透出，否则界面查表会拿到 undefined。
  await writeFile(runtimePath, JSON.stringify({ state: "banana" }), "utf-8");
  assert.equal(readDesktopTunnelRuntime(runtimePath).state, "disabled");

  await writeFile(runtimePath, "not json", "utf-8");
  assert.equal(readDesktopTunnelRuntime(runtimePath).state, "disabled");
});
