import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("useAgentSession.ts", source, ts.ScriptTarget.Latest, true);

// Execute the real hook closures with controlled layout/visibility and frame
// delivery. No browser dependency or duplicate scroll implementation is needed.
function loadClosure(predicate, bindings) {
  let callback;
  function visit(node) {
    if (predicate(node)) callback = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(callback, "hook callback must exist");
  const { outputText } = ts.transpileModule(`const callback = ${callback.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return new Function(...Object.keys(bindings), `${outputText}\nreturn callback;`)(...Object.values(bindings));
}

function isNamedCallback(name) {
  return (node) => ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === "useCallback"
    && ts.isVariableDeclaration(node.parent)
    && node.parent.name.getText(ast) === name;
}

function fixture() {
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const window = new EventTarget();
  const container = { clientHeight: 400, scrollTop: 0 };
  const content = {};
  const calls = [];
  const frames = new Map();
  let frameId = 0;
  let resize;
  let disconnected = false;
  const ref = (current) => ({ current });
  const bindings = {
    document,
    window,
    scrollContainerRef: ref(container),
    messagesEndRef: ref({ parentElement: content }),
    lastUserMsgRef: ref({}),
    messagesRef: ref([{}]),
    pendingScrollToUserRef: ref(false),
    initialScrollDoneRef: ref(true),
    isNearBottomRef: ref(true),
    scrollUserMsgToTop: () => calls.push("prompt"),
    scrollToBottom: (behavior) => calls.push(behavior),
    requestAnimationFrame: (callback) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id) => frames.delete(id),
    ResizeObserver: class {
      constructor(callback) { resize = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    },
  };
  const restore = loadClosure(isNamedCallback("restoreChatScroll"), bindings);
  const subscribe = loadClosure((node) => ts.isCallExpression(node)
    && node.expression.getText(ast) === "useEffect"
    && node.arguments[0]?.getText(ast).includes('window.addEventListener("focus", onForeground)'), {
    ...bindings,
    restoreChatScroll: restore,
  });
  return {
    bindings, calls, container, document, window, frames, restore, subscribe,
    resize: () => resize(),
    flush: () => {
      const queued = [...frames.values()];
      frames.clear();
      queued.forEach((callback) => callback());
    },
    get disconnected() { return disconnected; },
  };
}

test("returning to the foreground recovers an attached view after completion", () => {
  const f = fixture();
  const cleanup = f.subscribe();
  f.document.visibilityState = "hidden";
  f.restore();
  assert.deepEqual(f.calls, []);

  // The run may already be idle: recovery has no running-state dependency.
  f.document.visibilityState = "visible";
  f.document.dispatchEvent(new Event("visibilitychange"));
  assert.deepEqual(f.calls, ["auto"]);
  f.flush();
  assert.deepEqual(f.calls, ["auto", "auto"]);
  cleanup();
});

test("focus and layout recovery preserve an intentionally detached reader", () => {
  const f = fixture();
  f.bindings.isNearBottomRef.current = false;
  const cleanup = f.subscribe();
  f.window.dispatchEvent(new Event("focus"));
  f.resize();
  f.flush();
  assert.deepEqual(f.calls, []);
  cleanup();
});

test("an unmeasurable window cannot consume the pending prompt scroll", () => {
  const f = fixture();
  f.bindings.pendingScrollToUserRef.current = true;
  f.bindings.initialScrollDoneRef.current = false;
  const cleanup = f.subscribe();
  f.container.clientHeight = 0;
  f.window.dispatchEvent(new Event("focus"));
  f.flush();
  assert.equal(f.bindings.pendingScrollToUserRef.current, true);
  assert.equal(f.bindings.initialScrollDoneRef.current, false);
  assert.deepEqual(f.calls, []);

  f.container.clientHeight = 400;
  f.resize();
  f.flush();
  assert.deepEqual(f.calls, ["prompt"]);
  assert.equal(f.bindings.pendingScrollToUserRef.current, false);
  assert.equal(f.bindings.initialScrollDoneRef.current, true);
  cleanup();
});

test("initial scroll waits for a measurable visible layout", () => {
  const f = fixture();
  f.bindings.initialScrollDoneRef.current = false;
  f.document.visibilityState = "hidden";
  f.restore();
  assert.equal(f.bindings.initialScrollDoneRef.current, false);
  f.document.visibilityState = "visible";
  f.restore();
  assert.deepEqual(f.calls, ["instant"]);
});

test("layout restoration coalesces frames and cleans up listeners", () => {
  const f = fixture();
  const cleanup = f.subscribe();
  f.resize();
  f.resize();
  assert.equal(f.frames.size, 1);
  cleanup();
  assert.equal(f.frames.size, 0);
  assert.equal(f.disconnected, true);
  f.window.dispatchEvent(new Event("focus"));
  f.document.dispatchEvent(new Event("visibilitychange"));
  assert.deepEqual(f.calls, []);
});
