import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const source = readFileSync(new URL("./FileIcons.tsx", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { getFileIcon, GenericFileIcon } = await jiti.import("./FileIcons.tsx");

/** `getFileIcon` 返回 `<CatppuccinIcon name=… />`；没映射时返回 `<GenericFileIcon />`。 */
function iconName(node) {
  if (node?.props?.name) return node.props.name;
  if (node?.type === GenericFileIcon) return "_file";
  return undefined;
}

test("java sources get their own icon in both themes", () => {
  assert.equal(iconName(getFileIcon("App.java")), "java");
  assert.equal(iconName(getFileIcon("FlorensApplication.java")), "java");
  assert.equal(iconName(getFileIcon("SomeClass.JAVA")), "java");

  for (const theme of ["latte", "mocha"]) {
    const path = new URL(`../public/icons/catppuccin/${theme}/java.svg`, import.meta.url);
    assert.ok(existsSync(path), `${theme}/java.svg missing`);
    assert.match(readFileSync(path, "utf8"), /viewBox="0 0 16 16"/);
  }
});

test("java icons are wired into the shared icon table, not a special case", () => {
  assert.match(source, /\| "java"/);
  assert.match(source, /java: "java",/);
});

test("unmapped extensions still fall back to the generic document icon", () => {
  assert.equal(iconName(getFileIcon("pom.xml")), "_file");
  assert.equal(iconName(getFileIcon("notes.txt")), "_file");
  assert.equal(iconName(GenericFileIcon({})), "_file");
});
