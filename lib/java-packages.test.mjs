import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  isInsideJavaSourceRoot,
  isJavaPackageSegment,
  mergeJavaPackageChain,
  JAVA_PACKAGE_CHAIN_MAX_DEPTH,
} = await jiti.import("./java-packages.ts");

/** 用一个「路径 → 子项」表模拟磁盘，避免测试碰真实文件系统。 */
function treeReader(tree) {
  return (dir) => tree[dir] ?? [];
}

test("recognizes only src/main/java and src/test/java", () => {
  assert.equal(isInsideJavaSourceRoot("/repo/src/main/java"), true);
  assert.equal(isInsideJavaSourceRoot("/repo/src/test/java"), true);
  assert.equal(isInsideJavaSourceRoot("/repo/src/main/java/com/example"), true);
  assert.equal(isInsideJavaSourceRoot("C:\\repo\\src\\test\\java\\com"), true);

  // 自定义 sourceSet、只有片段相近但不成三元组的路径都不算
  assert.equal(isInsideJavaSourceRoot("/repo/src/it/java"), false);
  assert.equal(isInsideJavaSourceRoot("/repo/src/main/resources"), false);
  assert.equal(isInsideJavaSourceRoot("/repo/main/java"), false);
  assert.equal(isInsideJavaSourceRoot("/repo/src/main"), false);
});

test("accepts Java identifiers as package segments", () => {
  for (const name of ["com", "example", "demo", "my_app", "$generated", "E2E", "resources"]) {
    assert.equal(isJavaPackageSegment(name), true, name);
  }
  // 分隔符、连字符、空格、点号、数字开头都不是标识符，所以这类目录不会被折到包里
  for (const name of ["META-INF", "foo.bar", "1st", "", "a b"]) {
    assert.equal(isJavaPackageSegment(name), false, name);
  }
});

test("merges a single-child package chain into one dotted row", () => {
  const read = treeReader({
    "/r/src/main/java/com": [{ name: "example", isDir: true }],
    "/r/src/main/java/com/example": [{ name: "demo", isDir: true }],
    "/r/src/main/java/com/example/demo": [{ name: "App.java", isDir: false }],
  });

  const chain = mergeJavaPackageChain("/r/src/main/java", "com", read);

  assert.equal(chain.name, "com.example.demo");
  assert.equal(chain.packagePath, "/r/src/main/java/com/example/demo");
  assert.deepEqual(chain.segments, ["com", "example", "demo"]);
});

test("stops at a level that holds files and keeps it expandable", () => {
  const read = treeReader({
    "/r/src/main/java/com": [{ name: "example", isDir: true }],
    // 这一级既有类文件又有子包，必须留在行上
    "/r/src/main/java/com/example": [
      { name: "Demo.java", isDir: false },
      { name: "demo", isDir: true },
    ],
  });

  const chain = mergeJavaPackageChain("/r/src/main/java", "com", read);

  assert.equal(chain.name, "com.example");
  assert.equal(chain.packagePath, "/r/src/main/java/com/example");
});

test("stops at a single child that is not a package directory", () => {
  const read = treeReader({
    "/r/src/main/java/com": [{ name: "META-INF", isDir: true }],
  });

  const chain = mergeJavaPackageChain("/r/src/main/java", "com", read);

  assert.equal(chain.name, "com");
  assert.deepEqual(chain.segments, ["com"]);
});

test("stops at a single file child", () => {
  const read = treeReader({
    "/r/src/main/java/com": [{ name: "module-info.java", isDir: false }],
  });

  assert.equal(mergeJavaPackageChain("/r/src/main/java", "com", read).segments.length, 1);
});

test("does not run past the depth cap", () => {
  const tree = {};
  const names = Array.from({ length: JAVA_PACKAGE_CHAIN_MAX_DEPTH + 5 }, (_, i) => `p${i}`);
  let dir = "/r/src/main/java";
  for (const name of names) {
    tree[dir] = [{ name, isDir: true }];
    dir = `${dir}/${name}`;
  }

  const chain = mergeJavaPackageChain("/r/src/main/java", names[0], treeReader(tree));

  assert.equal(chain.segments.length, JAVA_PACKAGE_CHAIN_MAX_DEPTH);
  assert.equal(chain.name.split(".").length, JAVA_PACKAGE_CHAIN_MAX_DEPTH);
});

test("joins paths with the injected joiner so Windows separators survive", () => {
  const read = treeReader({
    "C:\\r\\src\\main\\java\\com": [{ name: "example", isDir: true }],
  });

  const chain = mergeJavaPackageChain("C:\\r\\src\\main\\java", "com", read, {
    joinPath: (dir, name) => `${dir}\\${name}`,
  });

  assert.equal(chain.packagePath, "C:\\r\\src\\main\\java\\com\\example");
});
