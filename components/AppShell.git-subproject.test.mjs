import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const sidebarSource = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const explorerSource = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");

test("a file-tree Git badge retargets the Git panel to that sub-project repository", () => {
  // 侧边栏把子项目行上的点击原样交给 AppShell：仓库根由文件浏览器给出，不是当前项目。
  assert.match(
    sidebarSource,
    /onOpenRepositoryGitPanel\?: \(repositoryPath: string\) => void;/,
  );
  assert.match(sidebarSource, /onOpenRepositoryGitPanel=\{onOpenRepositoryGitPanel\}/);
  assert.match(explorerSource, /onOpenRepositoryGitPanel\?: \(repositoryPath: string\) => void;/);
  assert.match(source, /onOpenRepositoryGitPanel=\{openRepositoryGitPanel\}/);

  // 点徽标是「打开到这个仓库」，不是切换：重复点击不会把面板关掉。
  assert.match(
    source,
    /const openRepositoryGitPanel = useCallback\(\(repositoryPath: string\) => \{\s*setGitPanelCwd\(repositoryPath\);\s*setGitPanelOpen\(true\);\s*\}, \[\]\);/,
  );
});

test("the panel target falls back to the project repository and closes cleanly", () => {
  // `gitPanelCwd` 为 null 时跟随当前项目，并且必须只在该项目确实是仓库时才渲染。
  assert.match(
    source,
    /const gitPanelTargetCwd = gitPanelCwd \?\? \(activeProjectIsGit === true \? activeCwd : null\);/,
  );
  assert.match(
    source,
    /const closeGitPanel = useCallback\(\(\) => \{\s*setGitPanelOpen\(false\);\s*setGitPanelCwd\(null\);\s*\}, \[\]\);/,
  );
  assert.match(source, /onClose=\{closeGitPanel\}/);
});

test("switching projects drops the previously selected sub-project repository", () => {
  // 上一个项目里的子仓库路径在新项目里可能不可达，不能让面板继续指着它。
  assert.match(
    source,
    /useEffect\(\(\) => \{\s*setGitPanelCwd\(null\);\s*\}, \[activeCwd\]\);/,
  );
});

test("a sub-project repository opens the panel even when the project root is not a repository", () => {
  // 主项目不是仓库时 `activeProjectIsGit === false`，但子项目自己带 `.git`，面板仍然要有内容。
  assert.match(
    source,
    /if \(activeProjectIsGit === false && gitPanelCwd === null\) setGitPanelOpen\(false\);/,
  );
});
