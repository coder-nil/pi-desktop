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

/** 一个 Maven 布局的项目：main/test 源码根、自定义 sourceSet、以及仓库根部的同名目录。 */
function makeJavaProject(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-java-packages-"));
  const write = (relative, content = "") => {
    const target = join(root, relative);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  };
  write("src/main/java/com/example/demo/App.java", "class App {}\n");
  write("src/test/java/com/example/demo/AppTest.java", "class AppTest {}\n");
  write("src/it/java/com/example/e2e/SmokeTest.java", "class SmokeTest {}\n");
  write("src/main/resources/application.yml", "a: b\n");
  write("com/example/demo/App.java", "class App {}\n");
  allowFileRoot(root);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("collapses a package chain into one dotted row under src/main/java", async (t) => {
  const root = makeJavaProject(t);

  const { entries } = await list(join(root, "src/main/java"));

  assert.deepEqual(
    entries.map((entry) => [entry.name, entry.isDir, entry.entryPath ?? null]),
    [["com.example.demo", true, join(root, "src/main/java/com/example/demo")]],
  );
});

test("collapses src/test/java the same way", async (t) => {
  const root = makeJavaProject(t);

  const { entries } = await list(join(root, "src/test/java"));

  assert.deepEqual(entries.map((entry) => entry.name), ["com.example.demo"]);
});

test("leaves custom source sets and non-Java directories alone", async (t) => {
  const root = makeJavaProject(t);

  const customSourceSet = await list(join(root, "src/it/java"));
  assert.deepEqual(customSourceSet.entries.map((entry) => entry.name), ["com"]);

  const repoRoot = await list(root);
  assert.deepEqual(repoRoot.entries.map((entry) => entry.name), ["com", "src"]);
});

test("a package level that holds classes keeps its own row", async (t) => {
  const root = makeJavaProject(t);
  const acme = join(root, "src/main/java/org/acme");
  mkdirSync(join(acme, "web"), { recursive: true });
  writeFileSync(join(acme, "Acme.java"), "class Acme {}\n");
  writeFileSync(join(acme, "web/Controller.java"), "class Controller {}\n");

  const { entries } = await list(join(root, "src/main/java"));

  assert.deepEqual(
    entries.map((entry) => [entry.name, entry.entryPath ?? null]),
    [
      ["com.example.demo", join(root, "src/main/java/com/example/demo")],
      ["org.acme", join(root, "src/main/java/org/acme")],
    ],
  );
});

test("a merged row expands into the innermost package contents", async (t) => {
  const root = makeJavaProject(t);

  const { entries } = await list(join(root, "src/main/java/com/example/demo"));

  assert.deepEqual(
    entries.map((entry) => [entry.name, entry.isDir]),
    [["App.java", false]],
  );
});
