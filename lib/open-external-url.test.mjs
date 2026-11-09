import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { isOpenableExternalUrl, openExternalUrl, takeOverExternalLink } = await jiti.import("./open-external-url.ts");

test("只放行 http(s) 链接", () => {
  assert.equal(isOpenableExternalUrl("https://qoder.com.cn/device/selectAccounts?x=1"), true);
  assert.equal(isOpenableExternalUrl("http://127.0.0.1:54681/callback"), true);
  for (const bad of ["", "javascript:alert(1)", "file:///etc/passwd", "qoder-work-cn://cb", "not a url"]) {
    assert.equal(isOpenableExternalUrl(bad), false, `should reject ${bad}`);
  }
});

test("非 http(s) 链接既不打开也不抛异常", async () => {
  assert.equal(await openExternalUrl("javascript:alert(1)"), "invalid");
});

test("浏览器里退回 window.open，被拦截时报告 blocked", async () => {
  const original = globalThis.window;
  try {
    // 没有任何窗口对象可开：当作被拦截处理。
    globalThis.window = { open: () => null };
    assert.equal(await openExternalUrl("https://example.com/login"), "blocked");

    let openedUrl = "";
    globalThis.window = {
      open: (url) => {
        openedUrl = String(url);
        return { closed: false };
      },
    };
    assert.equal(await openExternalUrl("https://example.com/login"), "window");
    assert.equal(openedUrl, "https://example.com/login");
  } finally {
    globalThis.window = original;
  }
});

test("桌面端 invoke 失败时把链接复制到剪贴板（绝不静默无反应）", async () => {
  const originalWindow = globalThis.window;
  const hadNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  try {
    let copied = "";
    // Node 24 的 navigator 是只读 getter，只能重新定义属性。
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { writeText: async (text) => { copied = String(text); } } },
      configurable: true,
    });
    let windowOpenCalls = 0;
    globalThis.window = {
      __PI_WEB_API_ORIGIN__: "http://127.0.0.1:54681",
      open: () => {
        windowOpenCalls += 1;
        return { closed: false };
      },
    };
    // 测试环境没有 Tauri IPC，invoke 必然失败；旧版桌面端（没有 open_external_url
    // 命令）也是这个表现。此时应该复制链接，而不是什么都不做。
    const result = await openExternalUrl("https://example.com/login");
    assert.equal(result, "copied");
    assert.equal(copied, "https://example.com/login");
    assert.equal(windowOpenCalls, 0);
  } finally {
    globalThis.window = originalWindow;
    if (hadNavigator) Object.defineProperty(globalThis, "navigator", hadNavigator);
    else delete globalThis.navigator;
  }
});

function clickEvent(overrides = {}) {
  const state = { prevented: false };
  return {
    state,
    event: {
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault() { state.prevented = true; },
      ...overrides,
    },
  };
}

test("桌面端接管 Markdown 外部链接点击，浏览器里保留原生行为", async () => {
  const originalWindow = globalThis.window;
  try {
    // 浏览器：不接管，让 target="_blank" / 修饰键的原生语义生效。
    globalThis.window = { open: () => ({ closed: false }) };
    const plain = clickEvent();
    assert.equal(takeOverExternalLink(plain.event, "https://example.com"), false);
    assert.equal(plain.state.prevented, false);

    // 桌面端：拦下并阻止默认导航（否则整个 WebView 会被导航走）。
    globalThis.window = { __PI_WEB_API_ORIGIN__: "http://127.0.0.1:54681", open: () => null };
    const desktop = clickEvent();
    assert.equal(takeOverExternalLink(desktop.event, "https://example.com"), true);
    assert.equal(desktop.state.prevented, true);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("修饰键 / 非左键 / 非 http(s) 链接一律不接管", async () => {
  const originalWindow = globalThis.window;
  try {
    globalThis.window = { __PI_WEB_API_ORIGIN__: "http://127.0.0.1:54681", open: () => null };
    for (const overrides of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
      const { state, event } = clickEvent(overrides);
      assert.equal(takeOverExternalLink(event, "https://example.com"), false, JSON.stringify(overrides));
      assert.equal(state.prevented, false);
    }
    const fileLink = clickEvent();
    assert.equal(takeOverExternalLink(fileLink.event, "qoder-work-cn://callback"), false);
  } finally {
    globalThis.window = originalWindow;
  }
});
