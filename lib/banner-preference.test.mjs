import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { getBannerEnabled, setBannerEnabled } = await jiti.import("./banner-preference.ts");

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("banner visibility defaults to enabled", () => {
  assert.equal(getBannerEnabled(createStorage()), true);
  assert.equal(getBannerEnabled(null), true);
});

test("banner visibility persists disabled and enabled values", () => {
  const storage = createStorage();

  setBannerEnabled(false, storage);
  assert.equal(getBannerEnabled(storage), false);

  setBannerEnabled(true, storage);
  assert.equal(getBannerEnabled(storage), true);
});

test("banner visibility falls back to enabled when storage is unavailable", () => {
  const blockedStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };

  assert.equal(getBannerEnabled(blockedStorage), true);
  assert.doesNotThrow(() => setBannerEnabled(false, blockedStorage));
});
