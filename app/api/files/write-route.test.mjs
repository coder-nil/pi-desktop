import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./[...path]/route.ts", import.meta.url), "utf8");
const start = source.indexOf("export async function PUT(");
const end = source.indexOf("export async function PATCH(", start);
assert.notEqual(start, -1, "PUT file route not found");
assert.notEqual(end, -1, "PUT file route end not found");
const putSource = source.slice(start, end);

test("file writes require trusted access to an existing allowed file", () => {
  assert.match(putSource, /isApiRequestAllowed\(request\)/);
  assert.match(putSource, /isFilePathAllowed\(filePath, allowedRoots\)/);
  assert.match(putSource, /isExistingFilePathAllowed\(filePath, allowedRoots\)/);
  assert.match(putSource, /stat\.isFile\(\)/);
});

test("file writes accept string content including an empty string", () => {
  assert.match(putSource, /typeof body\?\.content !== "string"/);
  assert.match(putSource, /Buffer\.byteLength\(body\.content, "utf8"\)/);
  assert.match(putSource, /fs\.writeFileSync\(filePath, body\.content, "utf8"\)/);
});

test("file writes block accidental empty overwrites unless explicitly allowed", () => {
  assert.match(putSource, /body\.content === "" && stat\.size > 0 && body\.allowEmpty !== true/);
  assert.match(putSource, /empty_overwrite_blocked/);
});
test("file writes return the persisted size as JSON", () => {
  assert.match(putSource, /const nextStat = fs\.statSync\(filePath\)/);
  assert.match(putSource, /NextResponse\.json\(\{ size: nextStat\.size/);
});
