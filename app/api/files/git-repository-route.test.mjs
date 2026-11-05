import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false });
const { GET } = await jiti.import("./[...path]/route.ts");
const { allowFileRoot } = await jiti.import("@/lib/file-access.ts");

async function list(filePath) {
  const response = await GET(
    new NextRequest(`http://localhost:30141/api/files/${filePath}?type=list`),
    { params: Promise.resolve({ path: filePath.split("/").filter(Boolean) }) },
  );
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

/**
 * 一个「项目目录里并排放着多个子项目」的布局：普通仓库、worktree / submodule 那种
 * `.git` 是文件的仓库、以及不带仓库的普通目录和文件。
 */
function makeMultiRepositoryProject(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-git-repositories-"));
  const write = (relative, content = "") => {
    const target = join(root, relative);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  };
  write("app/.git/HEAD", "ref: refs/heads/main\n");
  write("app/src/index.ts", "export {};\n");
  write("lib/.git", "gitdir: ../../.git/modules/lib\n");
  write("lib/package.json", "{}\n");
  write("docs/readme.md", "# docs\n");
  write("notes.txt", "hello\n");
  write("package.json", "{}\n");
  allowFileRoot(root);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("marks a child directory as its own repository when it contains .git", async (t) => {
  const root = makeMultiRepositoryProject(t);

  const { entries } = await list(root);

  assert.deepEqual(
    entries.map((entry) => [entry.name, entry.isDir, entry.gitRepository === true]),
    [
      ["app", true, true],
      ["docs", true, false],
      // worktree / submodule 的 `.git` 是指针文件，同样算一个独立仓库
      ["lib", true, true],
      ["notes.txt", false, false],
      ["package.json", false, false],
    ],
  );
});

test("keeps the flag out of entries that are not repositories", async (t) => {
  const root = makeMultiRepositoryProject(t);

  const { entries } = await list(root);
  const docs = entries.find((entry) => entry.name === "docs");
  const notes = entries.find((entry) => entry.name === "notes.txt");

  // 稀疏字段：不是仓库的条目连键都没有，列表响应不为每个文件多带一次 false。
  assert.equal("gitRepository" in docs, false);
  assert.equal("gitRepository" in notes, false);
});

test("lists the contents of a sub-project without inheriting the flag", async (t) => {
  const root = makeMultiRepositoryProject(t);

  const { entries } = await list(join(root, "app"));

  // `app` 自己是仓库，它的子目录并不是；`.git` 本身也被忽略规则挡在列表外。
  assert.deepEqual(entries.map((entry) => [entry.name, entry.gitRepository === true]), [["src", false]]);
});
