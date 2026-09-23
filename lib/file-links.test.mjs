import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./file-links.ts");
}

test("resolves absolute markdown file links and strips line suffixes", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref(
      "/home/me/project/components/MarkdownBody.tsx:36",
      "/home/me/project",
    ),
    "/home/me/project/components/MarkdownBody.tsx",
  );
});

test("resolves absolute file links outside cwd", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref(
      "/home/me/.codex/config.toml:12",
      "/home/me/project",
    ),
    "/home/me/.codex/config.toml",
  );
});

test("resolves relative markdown file links against cwd", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref("components/AppShell.tsx#L42", "/home/me/project"),
    "/home/me/project/components/AppShell.tsx",
  );
});

test("does not let relative links escape cwd", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref("../outside.md", "/home/me/project"),
    null,
  );
});

test("resolves preview links from the file directory within the project root", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref("../file.js", "/home/me/project/docs/nested", "/home/me/project"),
    "/home/me/project/docs/file.js",
  );
  assert.equal(
    resolveLocalFileHref("../../../outside.js", "/home/me/project/docs/nested", "/home/me/project"),
    null,
  );
});

test("does not treat app or external URLs as file links", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(resolveLocalFileHref("/api/files/home/me/project/a.ts", "/home/me/project"), null);
  assert.equal(resolveLocalFileHref("https://example.com/a.ts", "/home/me/project"), null);
  assert.equal(resolveLocalFileHref("ftp://example.com/a.ts", "/home/me/project"), null);
  assert.equal(resolveLocalFileHref("//example.com/a.ts", "/home/me/project"), null);
});

test("resolves Windows file URLs without a synthetic leading slash", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref("file:///C:/Users/me/project/file.txt:10", "C:/Users/me/project"),
    "C:/Users/me/project/file.txt",
  );
});

test("resolves UNC file URLs and backslash UNC paths", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref("file://server/share/project/file.txt", "/home/me/project"),
    "//server/share/project/file.txt",
  );
  assert.equal(
    resolveLocalFileHref("\\\\server\\share\\project\\file.txt", "/home/me/project"),
    "//server/share/project/file.txt",
  );
});

test("keeps the line and column a file link points at", async () => {
  const { resolveLocalFileTarget } = await loadSubject();

  assert.deepEqual(
    resolveLocalFileTarget("components/AppShell.tsx:42", "/home/me/project"),
    { filePath: "/home/me/project/components/AppShell.tsx", line: 42 },
  );
  assert.deepEqual(
    resolveLocalFileTarget("/home/me/project/a.ts:12:5", "/home/me/project"),
    { filePath: "/home/me/project/a.ts", line: 12, column: 5 },
  );
  // GitHub 风格的片段：#L42C7 以及区间取起始行。
  assert.deepEqual(
    resolveLocalFileTarget("components/AppShell.tsx#L42", "/home/me/project"),
    { filePath: "/home/me/project/components/AppShell.tsx", line: 42 },
  );
  assert.deepEqual(
    resolveLocalFileTarget("components/AppShell.tsx#L42C7-L60", "/home/me/project"),
    { filePath: "/home/me/project/components/AppShell.tsx", line: 42, column: 7 },
  );
});

test("does not mistake paths or anchors for a line number", async () => {
  const { resolveLocalFileTarget } = await loadSubject();

  // Windows 盘符与普通锚点都不带行号。
  assert.deepEqual(
    resolveLocalFileTarget("C:/Users/me/project/file.ts", "C:/Users/me/project"),
    { filePath: "C:/Users/me/project/file.ts" },
  );
  assert.deepEqual(
    resolveLocalFileTarget("README.md#installation", "/home/me/project"),
    { filePath: "/home/me/project/README.md" },
  );
  assert.deepEqual(
    resolveLocalFileTarget("file:///C:/Users/me/project/file.txt:10", "C:/Users/me/project"),
    { filePath: "C:/Users/me/project/file.txt", line: 10 },
  );
});
