import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./typewriter.ts");
}

test("reveals text forward without skipping the start", async () => {
  const { revealNext } = await loadSubject();
  const first = revealNext("", "feat: add project management");
  assert.ok(first.length > 0 && first.length < "feat: add project management".length);
  assert.ok("feat: add project management".startsWith(first));
});

test("catches up on a burst and settles exactly on the target", async () => {
  const { revealNext } = await loadSubject();
  const target = "x".repeat(600);
  let displayed = "";
  for (let frame = 0; frame < 300 && displayed !== target; frame += 1) {
    displayed = revealNext(displayed, target);
  }
  assert.equal(displayed, target);
});

test("snaps when the preview rewrites earlier characters", async () => {
  const { revealNext } = await loadSubject();
  assert.equal(revealNext("feat: old", "refactor: new"), "refactor: new");
});

test("is a no-op once caught up", async () => {
  const { revealNext } = await loadSubject();
  assert.equal(revealNext("feat: add", "feat: add"), "feat: add");
});
