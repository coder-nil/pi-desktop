import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./DirectoryPicker.tsx", import.meta.url), "utf8");
const backdropSource = source.slice(
  source.indexOf('className="directory-picker-backdrop"'),
  source.indexOf('className="directory-picker-panel"'),
);

test("does not close the directory picker when its backdrop is clicked", () => {
  assert.doesNotMatch(backdropSource, /onClick=/);
});

test("keeps Escape as a directory picker close action", () => {
  assert.match(backdropSource, /event\.key === "Escape" && !busy\) onCancel\(\)/);
});
