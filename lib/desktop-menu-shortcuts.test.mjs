import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const libSource = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");

test("macOS drops the default Undo/Redo menu items so ⌘Z reaches the page", () => {
  // Tauri 在 macOS 上默认安装 Menu::default，其中的 Edit > Undo / Redo 带
  // ⌘Z / ⌘⇧Z 的 key equivalent，NSMenu 会在 WebView 之前把按键吃掉，页面收不到
  // keydown（Ctrl+Z 能到，因为它不是菜单快捷键）。这两个菜单项必须删掉。
  assert.match(
    libSource,
    /#\[cfg\(target_os = "macos"\)\]\s*\nfn remove_default_undo_redo_menu_items/,
  );
  assert.match(libSource, /let menu = Menu::default\(app\)\?;/);
  assert.match(libSource, /if submenu\.text\(\)\? != "Edit"/);
  // Edit 子菜单固定以 undo / redo 开头，删前两项。
  assert.equal((libSource.match(/submenu\.remove_at\(0\)\?/g) ?? []).length, 2);
  assert.match(libSource, /app\.set_menu\(menu\)\?;/);
});

test("the menu fix is installed during setup, and only on macOS", () => {
  assert.match(
    libSource,
    /#\[cfg\(target_os = "macos"\)\]\s*\n\s+remove_default_undo_redo_menu_items\(app\.handle\(\)\)\?;/,
  );
  // Windows / Linux 没有这套菜单拦截，不要在那边也重建菜单。
  // 定义体带泛型参数（`<R: tauri::Runtime>`），所以这个带括号的调用只有 setup 处一次。
  assert.equal((libSource.match(/remove_default_undo_redo_menu_items\(/g) ?? []).length, 1);
});
