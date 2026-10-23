import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const dialog = source.slice(source.indexOf("function ExtensionDialog("), source.indexOf("type ExtensionCustomRequest"));

test("the desktop select dialog always offers a custom answer", () => {
  // 扩展（`ask_user` 走的就是这条路径）给的选项再全也可能不是用户想说的那个词。
  // 没有这条出口时，用户只能取消整轮对话，所以它必须无条件出现在选项之后。
  assert.match(dialog, /const \[customAnswer, setCustomAnswer\] = useState\(false\)/);
  assert.match(dialog, /\{t\("chat.customAnswer"\)\}/);
  assert.match(dialog, /setCustomAnswer\(true\)/);
});

test("the custom answer entry turns into the input in place", () => {
  // 点一下就地变成输入框，placeholder 就是「自定义答案」本身。
  assert.match(dialog, /\{customAnswer \? \(\s*<input/);
  assert.match(dialog, /placeholder=\{t\("chat.customAnswer"\)\}/);
  assert.match(dialog, /const trimmed = value\.trim\(\)/);
  assert.match(dialog, /onRespond\(request, \{ value: trimmed \}\)/);
  // 空文本不能变成答案。
  assert.match(dialog, /if \(!trimmed\) return;/);
});

test("select keeps its no-confirm click path until the custom entry is used", () => {
  // 直接点选项就是答案；只有走自定义路径才显示提交键。
  assert.match(dialog, /\) : customAnswer \? \(/);
  assert.match(dialog, /disabled=\{!value\.trim\(\)\}/);
});

test("the custom answer state resets with the request id", () => {
  // 状态对账每 15s 会带来一个新的请求对象，按对象重置会抹掉用户正在打的字。
  assert.match(dialog, /\}, \[request\.id, initialValue\]\);/);
  assert.match(dialog, /setValue\(initialValue\);\s*setCustomAnswer\(false\);/);
});
