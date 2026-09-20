import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./GitPanel.tsx", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const globalStyles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("matches the Git header height to the file-panel tab bar", () => {
  assert.match(source, /<header style=\{\{ height: "calc\(36px \+ env\(safe-area-inset-top\)\)"/);
  assert.match(source, /padding: "env\(safe-area-inset-top\) 14px 0"/);
  assert.match(source, /flexShrink: 0/);
});

test("renders Git panel text through i18n", () => {
  assert.match(source, /import \{ useI18n \} from "@\/hooks\/useI18n"/);
  assert.match(source, /const \{ t \} = useI18n\(\)/);
  for (const key of ["git.loadingRepository", "git.notRepository", "git.commitStaged", "git.rebaseWhenPulling", "git.mergeBranch", "git.stage", "git.stageAll", "git.unstageAll", "git.discardFileConfirm", "git.discardAll"]) {
    assert.match(source, new RegExp(`t\\("${key}"`));
  }
});

test("supports staging, unstaging, and discarding all visible changes in one Git action", () => {
  assert.match(source, /run\("stage", \{ paths: unstaged\.map\(\(file\) => file\.filePath\) \}\)/);
  assert.match(source, /run\("unstage", \{ paths: staged\.map\(\(file\) => file\.filePath\) \}\)/);
  assert.match(source, /run\("discard_all"\)/);
  assert.match(source, /label=\{t\("git\.stageAll"\)\}/);
  assert.match(source, /label=\{t\("git\.unstageAll"\)\}/);
  assert.match(source, /label=\{t\("git\.discardAll"\)\}/);
  // The discard-all button must only appear for real worktree changes, otherwise
  // it renders for staged-only/untracked-only trees and looks broken when clicked.
  assert.match(source, /const hasDiscardableChanges = unstaged\.some\(\(file\) => file\.status !== "untracked"\)/);
  assert.match(source, /\{hasDiscardableChanges && <ActionButton label=\{t\("git\.discardAll"\)\}/);
  assert.doesNotMatch(source, /summary\?\.changes\.files\.length > 0 && <ActionButton label=\{t\("git\.discardAll"\)\}/);
  assert.match(source, /title=\{t\("git\.discardAllTitle"\)\}/);
});

test("opens a clicked changed file in the existing diff viewer", () => {
  assert.match(source, /onOpenFile: \(filePath: string, fileName: string, options\?: \{ modeHint\?: "diff" \}\) => void/);
  assert.match(source, /onOpenFile\(file\.filePath, fileName\(file\.filePath\), \{ modeHint: "diff" \}\)/);
  assert.match(source, /onOpenDiff=\{openDiff\}/);
  assert.match(source, /<button type="button" onClick=\{\(\) => onOpenDiff\(file\)\}/);
  assert.doesNotMatch(source.slice(source.indexOf("const openDiff"), source.indexOf("const staged")), /onClose\(\)/);
  assert.match(appShellSource, /onChanged=\{handleExplorerRefresh\} onOpenFile=\{handleOpenFile\}/);
  const gitPanelMount = appShellSource.indexOf("<GitPanel cwd={activeCwd}");
  const filePanelMount = appShellSource.indexOf('id="file-panel"');
  assert.ok(gitPanelMount >= 0 && gitPanelMount < filePanelMount, "Git panel must be mounted immediately before file-panel");
  assert.match(globalStyles, /Dock the Git panel as a real split-layout panel immediately left of file-panel/);
  assert.match(globalStyles, /@media \(min-width: 960px\) \{[\s\S]*?\.git-panel-overlay \{[\s\S]*?position: relative;/);
  assert.match(globalStyles, /flex: 0 0 min\(460px, 38vw\)/);
  assert.match(globalStyles, /\.git-panel-dialog \{[\s\S]*?width: 100% !important;/);
  assert.doesNotMatch(source, /dockToFilePreview|filePanelRightOffset|getElementById\("file-panel"\)/);
  assert.doesNotMatch(globalStyles, /\.git-panel-overlay\s*\{[^}]*rgba\(0, 0, 0, 0\.34\)/);
});

test("keeps change lists scrollable at a fixed height", () => {
  assert.match(source, /height: 220/);
  assert.match(source, /overflowY: "auto"/);
});

test("summarizes staged changes with or without a selected session", () => {
  assert.match(source, /sessionId: string \| null/);
  assert.match(source, /fetch\("\/api\/git\/commit-message"/);
  assert.match(source, /JSON\.stringify\(\{ cwd, locale/);
  assert.match(source, /setMessage\(data\.message\)/);
  assert.match(source, /rows=\{7\}/);
  assert.match(source, /git\.summarizeCommit/);
  assert.doesNotMatch(source, /if \(!sessionId\) return/);
  assert.doesNotMatch(source, /disabled=\{!sessionId \|\| staged\.length/);
});

test("selects a non-current local branch to merge with a custom picker", () => {
  assert.match(source, /branches: string\[\]/);
  assert.match(source, /summary\?\.branches\.filter\(\(branch\) => branch !== summary\.branch\)/);
  assert.match(source, /<MergeBranchPicker branches=\{mergeBranches\}/);
  assert.match(source, /role="combobox"/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /git\.selectBranch/);
  assert.doesNotMatch(source, /<select value=\{mergeBranch\}/);
});

test("collects protocol-specific remote credentials without putting secrets in the remote URL", () => {
  assert.match(source, /credentialKind: "https" \| "ssh" \| "none"/);
  assert.match(source, /git\.httpsCredentials/);
  assert.match(source, /git\.sshCredentials/);
  assert.match(source, /type="password"/);
  assert.match(source, /git\.rememberCredential/);
  assert.doesNotMatch(source, /remote.*password/i);
});

test("edits the displayed remote URL through the Git action API", () => {
  assert.match(source, /action="set_remote_url"/);
  assert.match(source, /remoteUrl: remoteDraft/);
  assert.match(source, /setEditingRemote\(true\)/);
  assert.match(source, /git\.editRemote/);
  assert.match(source, /git\.saveRemote/);
});

test("restores the saved username and remembered state into the credential form", () => {
  assert.match(source, /savedCredentialUsername: string \| null/);
  assert.match(source, /setRememberCredential\(Boolean\(summary\?\.hasSavedCredential\)\)/);
  assert.match(source, /setUsername\(summary\.savedCredentialUsername \?\? ""\)/);
  assert.match(source, /const SAVED_CREDENTIAL_MASK = "••••••••"/);
  assert.match(source, /setSecret\(SAVED_CREDENTIAL_MASK\)/);
  assert.match(source, /secret !== SAVED_CREDENTIAL_MASK/);
  assert.match(source, /onFocus=\{\(\) => \{ if \(secret === SAVED_CREDENTIAL_MASK\) setSecret\(""\); \}\}/);
  // The mask is display-only and must never be submitted as the real secret.
  assert.doesNotMatch(source, /savedCredentialSecret/i);
});
