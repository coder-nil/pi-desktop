import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

function fileContentBlock() {
  const start = source.indexOf("{activeFileTab?.filePath ? (");
  const end = source.indexOf("</div>\n      </div>\n    </div>", start);
  assert.notEqual(start, -1, "active file content branch not found");
  assert.notEqual(end, -1, "end of file content block not found");
  return source.slice(start, end);
}

function dynamicDeclaration(component) {
  const start = source.indexOf(`const ${component} = dynamic(`);
  const boundaries = [source.indexOf("\nconst ", start + 1), source.indexOf("\ntype ", start + 1)]
    .filter((index) => index > start);
  const end = Math.min(...boundaries);
  assert.notEqual(start, -1, `${component} dynamic declaration not found`);
  assert.ok(Number.isFinite(end), `${component} dynamic declaration end not found`);
  return source.slice(start, end);
}

test("opening the file panel preserves the visible chat message during desktop resize", () => {
  assert.match(source, /if \(!rightPanelOpen && !isMobile && window\.matchMedia\("\(min-width: 960px\)"\)\.matches\)/);
  assert.match(source, /preserveChatScrollDuringPanelTransition\(container\)/);
  assert.ok(
    source.indexOf("preserveChatScrollDuringPanelTransition(container)")
      < source.indexOf("setRightPanelOpen(true)", source.indexOf("const handleOpenFile")),
    "scroll preservation must start before the panel expands",
  );
});

test("shows the main file toggle only while the file panel is closed", () => {
  assert.match(source, /const renderMainFileToggle = \(mobile: boolean\) => \{\s*if \(rightPanelOpen\) return null;/);
  assert.match(source, /onClick=\{\(\) => setRightPanelOpen\(false\)\}[\s\S]*?aria-label=\{translate\("files\.hidePanel"\)\}/);
});

test("keeps the desktop file toggle inside the open minimap column", () => {
  assert.match(source, /if \(!mobile && minimapState\.visible\) return null;/);
  assert.match(source, /const renderMinimapFileToggle = \(\) => \(/);
  assert.match(source, /const renderMinimapFileToggle[\s\S]{0,600}?aria-controls="file-panel"[\s\S]{0,600}?data-minimap-file-toggle=""/);
  assert.match(source, /\{minimapState\.visible && renderMinimapFileToggle\(\)\}/);
  // 竖线从开关下方开始画，免得从图标中间穿过
  assert.match(source, /backgroundPosition: `0 \$\{TOP_BAR_ICON_BUTTON_SIZE\}px`/);
});

test("eagerly loads file and configuration components", () => {
  for (const component of ["FileViewer", "SettingsPanel"]) {
    assert.match(source, new RegExp(`import \\{ ${component} \\} from \\"\\./${component}\\";`));
    assert.doesNotMatch(source, new RegExp(`const ${component} = dynamic\\(`));
  }
});

test("keeps the terminal panel lazy-loaded", () => {
  assert.match(dynamicDeclaration("TerminalPanel"), /\{ ssr: false \}/);
});

test("only the active file tab mounts a FileViewer", () => {
  const block = fileContentBlock();
  assert.match(block, /activeFileTab\?\.filePath \? \(/);
  assert.doesNotMatch(block, /fileTabs\.map\(/);
  assert.equal(block.match(/<FileViewer/g)?.length, 1);
});

test("the active viewer restores tab state and saves it with a revision", () => {
  const block = fileContentBlock();
  assert.match(block, /key=\{`\$\{activeFileTab\.id\}:\$\{activeFileTab\.viewerRevision \?\? 0\}`\}/);
  assert.match(block, /initialState=\{activeFileTab\.viewerState\}/);
  assert.match(block, /handleFileViewerStateChange\(\s*activeFileTab\.id,\s*activeFileTab\.viewerRevision \?\? 0,/);
});

test("closing the file panel pauses the active viewer watcher", () => {
  assert.match(fileContentBlock(), /watchEnabled=\{rightPanelOpen\}/);
});
