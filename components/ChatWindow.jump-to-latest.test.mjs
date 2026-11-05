import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const chatInput = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const zhMessages = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");
const enMessages = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");

test("tracks the back-to-bottom state from the message scroll container", () => {
  assert.match(chatWindow, /const \[showJumpToLatest, setShowJumpToLatest\] = useState\(false\)/);
  // 判定走 lib/chat-lazy-load.ts 的纯函数，该函数自己拥有「离底多远才弹」这个阈值。
  assert.match(
    chatWindow,
    /const show = shouldShowJumpToLatest\(container\.scrollTop, container\.clientHeight, container\.scrollHeight\);\s*\n\s*setShowJumpToLatest\(\(previous\) => \(previous === show \? previous : show\)\);/,
  );
  // 只有滚到尾部才隐藏，也就是说按钮与 useAgentSession 的贴底跟随指向同一个位置。
  assert.match(chatWindow, /container\.addEventListener\("scroll", syncJumpVisibility, \{ passive: true \}\)/);
  assert.match(chatWindow, /container\.removeEventListener\("scroll", syncJumpVisibility\)/);
  // 按 messages.length 重订阅会让流式增长与贴底跟随之间的那一帧被误判成离开底部。
  assert.match(chatWindow, /\}, \[scrollContainerRef, isNew, hasNoMessages\]\);/);
  assert.doesNotMatch(chatWindow, /\}, \[scrollContainerRef, isNew, messages\.length\]\);/);
});

test("jumps back through the shared scrollToBottom and honours reduced motion", () => {
  assert.match(
    chatWindow,
    /window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches;[\s\S]*?scrollToBottom\(reduceMotion \? "auto" : "smooth"\)/,
  );
  // 状态在 ChatWindow，渲染在 ChatInput：它属于输入框那一层，不是消息区的浮层。
  assert.match(chatWindow, /showJumpToLatest=\{showJumpToLatest\}\s*\n\s*onJumpToLatest=\{handleJumpToLatest\}/);
});

test("renders the button on the composer layer, before the field", () => {
  assert.match(chatInput, /showJumpToLatest\?: boolean;\s*\n\s*\n?\s*onJumpToLatest\?: \(\) => void;/);
  const usages = chatInput.match(/className="chat-jump-to-latest"/g) ?? [];
  assert.equal(usages.length, 1);
  // 必须在 .chat-composer-field 之前：输入框要画在它上面，盖住重合的 1px。
  const notchAt = chatInput.indexOf('className="chat-jump-to-latest"');
  const fieldAt = chatInput.indexOf('className="chat-composer-field"');
  assert.ok(notchAt > 0 && fieldAt > notchAt, "button must precede the composer field");
  assert.match(
    chatInput,
    /aria-label=\{t\("chat\.jumpToLatest"\)\}\s*\n\s*title=\{t\("chat\.jumpToLatest"\)\}/,
  );
  assert.match(chatInput, /import \{ChevronDown\} from "lucide-react";/);
  assert.match(chatInput, /<ChevronDown size=\{13\} strokeWidth=\{2\} aria-hidden="true" \/>/);
  // 内联 svg 只画装饰性轮廓（对辅助技术隐藏），图标仍然只用 lucide。
  assert.match(chatInput, /<svg className="chat-jump-to-latest__shape"[^>]*aria-hidden="true" focusable="false">/);
  assert.match(chatInput, /<ChevronDown size=\{13\} strokeWidth=\{2\} aria-hidden="true" \/>/);
});

test("draws a splayed outline instead of a plain half ellipse", () => {
  // 矩形的 border 在底边处只能是垂直切线，撇不出去，所以轮廓改成内联 SVG。
  assert.match(chatInput, /<svg className="chat-jump-to-latest__shape" viewBox="0 0 84 22"/);
  assert.match(chatInput, /<path d="M0\.5 22C3\.5 16 11 4\.2 42 4\.2S80\.5 16 83\.5 22" \/>/);
  // 形状不做成矩形：按钮本体不带边框/底色，只有 84×22 的点击盒。
  assert.match(css, /\.chat-jump-to-latest \{[^}]*border: 0;[^}]*background: none;/);
  assert.match(css, /\.chat-jump-to-latest \{[^}]*width: 84px;[^}]*height: 22px;/);
  // 居中走 translate、transform 留给按压：animation 的 fill 会盖住 transform。
  assert.match(css, /\.chat-jump-to-latest \{[^}]*translate: -50% 0;/);
  assert.match(css, /animation: chat-jump-to-latest-in 200ms cubic-bezier\(0\.16, 1, 0\.3, 1\) backwards;/);
  assert.doesNotMatch(css, /chat-jump-to-latest-in 200ms cubic-bezier\(0\.16, 1, 0\.3, 1\) both;/);
});

test("keeps the outline glued to the field and 1px wide while it scales", () => {
  // 形状铺满按钮（bottom: 0）+ 按钮负 1px 上移：底边压过输入框上边框 1px，
  // 那条线在疙瘩宽度内被顶开，疙瘩与框内连通。
  assert.match(css, /\.chat-jump-to-latest \{[^}]*margin-bottom: -1px;/);
  assert.match(css, /\.chat-jump-to-latest__shape \{[^}]*bottom: 0;/);
  assert.match(css, /\.chat-jump-to-latest__shape path \{[^}]*vector-effect: non-scaling-stroke;[^}]*stroke-width: 1;/);
  // 描边/填充通过自定义属性下发，hover、focus-within、深色都只换变量。
  // 无焦点时只是一层白色半透明的雾面凸起，自己不描边。
  assert.match(css, /\.chat-jump-to-latest \{[^}]*--jump-fill: color-mix\(in srgb, #fff 42%, transparent\);[^}]*--jump-stroke: transparent;/);
  assert.doesNotMatch(css, /\.chat-jump-to-latest \{[^}]*--jump-stroke: color-mix/);
  // 悬停一律变不透明，仍然不给它加框。
  assert.match(css, /\.chat-jump-to-latest:hover \{[^}]*--jump-fill: #fff;/);
  assert.doesNotMatch(css, /\.chat-jump-to-latest:hover \{[^}]*--jump-stroke/);
  // 输入框有焦点时只换颜色：填充变淡蓝半透明，描边仍旧继承基类的透明。
  assert.match(css, /\.chat-jump-to-latest:has\(~ \.chat-composer-field:focus-within\) \{[^}]*--jump-fill: color-mix\(in srgb, var\(--accent\) 22%, transparent\);/);
  assert.doesNotMatch(css, /\.chat-jump-to-latest:has\(~ \.chat-composer-field:focus-within\) \{[^}]*--jump-stroke/);
  // 聚焦 + 悬停：同样是不透明那条规则，用不透明的淡蓝，也不加边。
  assert.match(css, /\.chat-jump-to-latest:has\(~ \.chat-composer-field:focus-within\):hover \{[^}]*--jump-fill: color-mix\(in srgb, var\(--accent\) 22%, var\(--bg\)\);/);
  assert.doesNotMatch(css, /\.chat-jump-to-latest:has\(~ \.chat-composer-field:focus-within\):hover \{[^}]*--jump-stroke/);
  // 输入框聚焦只换颜色，贴着的那一段不再有「跟色」问题（见下一条断言）。
});

test("gives keyboard focus a visible ring on the irregular outline", () => {
  // outline 会沿矩形框走，形状不规则时改用加粗的轮廓本身。
  assert.match(css, /\.chat-jump-to-latest:focus-visible \{[^}]*outline: none;/);
  assert.match(css, /\.chat-jump-to-latest:focus-visible \.chat-jump-to-latest__shape path \{[^}]*stroke: var\(--accent\);[^}]*stroke-width: 2;/);
  // 可见形状只有 84×22，热区靠伪元素补到宽高都过 24px。
  assert.match(css, /\.chat-jump-to-latest::before \{[^}]*top: -7px;[^}]*left: -7px;/);
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.chat-jump-to-latest \{\s*animation: none;\s*transition: none;/,
  );
});

test("ships the label in both locales", () => {
  assert.match(zhMessages, /"chat\.jumpToLatest": "回到最新",/);
  assert.match(enMessages, /"chat\.jumpToLatest": "Jump to latest",/);
});
