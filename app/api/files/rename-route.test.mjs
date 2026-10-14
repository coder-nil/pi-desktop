import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./[...path]/route.ts", import.meta.url), "utf8");
const patchSource = source.slice(source.indexOf("export async function PATCH("), source.indexOf("export async function GET("));

test("file rename requests require trusted same-origin API access", () => {
  assert.match(patchSource, /isApiRequestAllowed\(request\)/);
  assert.match(patchSource, /status: 403/);
});

test("file rename stays within allowed roots for files and directories", () => {
  assert.match(patchSource, /isFilePathAllowed\(sourcePath, allowedRoots\)/);
  assert.match(patchSource, /isFilePathAllowed\(destinationPath, allowedRoots\)/);
  assert.match(patchSource, /isExistingFilePathAllowed\(sourcePath, allowedRoots\)/);
  assert.match(patchSource, /isExistingFilePathAllowed\(parentPath, allowedRoots\)/);
  assert.doesNotMatch(patchSource, /Directory rename is not supported/);
});

test("file rename rejects an occupied destination before renaming", () => {
  assert.match(patchSource, /fs\.existsSync\(destinationPath\)/);
  assert.match(patchSource, /code: "already_exists"/);
  assert.match(patchSource, /fs\.renameSync\(sourcePath, destinationPath\)/);
});
