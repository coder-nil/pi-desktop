import assert from "node:assert/strict";
import test from "node:test";

const { addProjectHistory, getHiddenProjectHistory, getProjectHistory, hideProjectHistory, removeProjectHistory } = await import("./project-history.ts");

function createStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

test("project history keeps the newest validated project first without duplicates", () => {
  const storage = createStorage();
  addProjectHistory("/work/one", storage);
  addProjectHistory("/work/two", storage);
  assert.deepEqual(addProjectHistory("/work/one", storage), ["/work/one", "/work/two"]);
});

test("project history removes one entry without deleting other history", () => {
  const storage = createStorage();
  addProjectHistory("/work/one", storage);
  addProjectHistory("/work/two", storage);
  assert.deepEqual(removeProjectHistory("/work/one", storage), ["/work/two"]);
  assert.deepEqual(getProjectHistory(storage), ["/work/two"]);
});

test("hiding a project only removes it from the selector", () => {
  const storage = createStorage();
  addProjectHistory("/work/one", storage);
  assert.deepEqual(hideProjectHistory("/work/one", storage), ["/work/one"]);
  assert.deepEqual(getProjectHistory(storage), ["/work/one"]);
  assert.deepEqual(getHiddenProjectHistory(storage), ["/work/one"]);
});
