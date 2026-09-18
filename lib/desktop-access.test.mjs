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
  readDesktopLanAccess,
  readDesktopLanRuntime,
  validateDesktopAccessPassword,
  writeDesktopLanAccess,
} = await jiti.import("./desktop-access.ts");

async function withDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "pi-desktop-lan-access-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("round-trips the phone access config with owner-only permissions", async (t) => {
  const directory = await withDirectory(t);
  const configPath = join(directory, "desktop-access.json");

  assert.deepEqual(readDesktopLanAccess(configPath), { enabled: false, password: null });

  writeDesktopLanAccess({ enabled: true, password: "long-enough-secret" }, configPath);

  assert.deepEqual(readDesktopLanAccess(configPath), {
    enabled: true,
    password: "long-enough-secret",
  });
  assert.equal(statSync(configPath).mode & 0o777, 0o600);
});

test("never reports enabled without a password", async (t) => {
  const directory = await withDirectory(t);
  const configPath = join(directory, "desktop-access.json");

  // 直接写文件（模拟手工改坏或旧版本写入的内容）。
  await writeFile(configPath, JSON.stringify({ enabled: true, password: "" }), "utf-8");
  assert.equal(readDesktopLanAccess(configPath).enabled, false);

  writeDesktopLanAccess({ enabled: true, password: null }, configPath);
  assert.equal(readDesktopLanAccess(configPath).enabled, false);

  await writeFile(configPath, "not json", "utf-8");
  assert.deepEqual(readDesktopLanAccess(configPath), { enabled: false, password: null });
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

  writeDesktopLanAccess({ enabled: true, password: "long-enough-secret" }, configPath);

  const raw = JSON.parse(await readFile(configPath, "utf-8"));
  assert.deepEqual(raw, { enabled: true, password: "long-enough-secret" });
});
