"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, type Ref, lazy, Suspense } from "react";
import { type EditorProps, type OnMount } from "@monaco-editor/react";
// 只导类型：import type 编译后整条擦除，不会在 Node 求值 monaco-editor 的
// ESM 入口——那个入口在模块顶层就碰 window，Next.js 的 SSR 预渲染会把
// "use client" 的模块也走一遍 import，值导入会直接让服务端崩溃。
import type * as monaco from "monaco-editor";

export interface MonacoEditorHandle {
  focus: () => void;
  getValue: () => string;
  getModel: () => monaco.editor.ITextModel | null;
}

interface MonacoFileEditorProps {
  value: string;
  language: string;
  dark: boolean;
  onChange: (next: string) => void;
  onSave: (value: string) => void;
  onBlur?: () => void;
  handleRef?: Ref<MonacoEditorHandle>;
}

function mapLanguage(lang: string): string {
  const map: Record<string, string> = {
    javascript: "javascript",
    jsx: "javascript",
    typescript: "typescript",
    tsx: "typescript",
    python: "python",
    html: "html",
    css: "css",
    scss: "scss",
    less: "less",
    json: "json",
    jsonl: "json",
    markdown: "markdown",
    mdx: "markdown",
    yaml: "yaml",
    yml: "yaml",
    sql: "sql",
    rust: "rust",
    go: "go",
    java: "java",
    kotlin: "kotlin",
    swift: "swift",
    c: "c",
    cpp: "cpp",
    csharp: "csharp",
    h: "c",
    hpp: "cpp",
    php: "php",
    xml: "xml",
    bash: "bash",
    sh: "shell",
    zsh: "shell",
    fish: "shell",
    dockerfile: "dockerfile",
    env: "shell",
    gitignore: "shell",
  };
  return map[lang] ?? lang;
}

const LazyEditor = lazy(async (): Promise<{ default: React.ComponentType<EditorProps> }> => {
  const [{ default: loader }, monaco] = await Promise.all([
    import("@monaco-editor/loader"),
    import("monaco-editor"),
  ]);
  loader.config({ monaco: monaco as unknown as Parameters<typeof loader.config>[0]["monaco"] });
  const mod = await import("@monaco-editor/react");
  const Editor = mod.Editor as unknown as React.ComponentType<EditorProps>;
  return { default: Editor };
});

export function MonacoFileEditor({
  value,
  language,
  dark,
  onChange,
  onSave,
  handleRef,
}: MonacoFileEditorProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  useImperativeHandle(handleRef, () => ({
    focus: () => editorRef.current?.focus(),
    getValue: () => editorRef.current?.getValue() ?? "",
    getModel: () => editorRef.current?.getModel() ?? null,
  }), []);

  const monacoTheme = dark ? "vs-dark" : "light";

  const editorOptions = useMemo(() => {
    const fontSize = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--code-font-size")) || 12;
    const fontFamily = getComputedStyle(document.documentElement).getPropertyValue("--font-mono");

    return {
      automaticLayout: true,
      minimap: { enabled: true },
      lineNumbers: "on" as const,
      glyphMargin: true,
      folding: true,
      wordWrap: "off" as const,
      scrollBeyondLastLine: false,
      tabSize: 4,
      insertSpaces: true,
      fontSize,
      fontFamily,
      theme: monacoTheme,
    };
  }, [monacoTheme]);

  const handleEditorChange = useCallback((next: string | undefined) => {
    if (typeof next !== "string") return;
    onChange(next);
  }, [onChange]);

  const handleExplicitSave = useCallback(() => {
    onSave(editorRef.current?.getValue() ?? value);
  }, [onSave, value]);

  const handleMount = useCallback<OnMount>((editor, monacoApi) => {
    editorRef.current = editor;
    // 只通过明确的保存命令写入文件，避免失焦或定时器提交瞬时空值。
    editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyS, handleExplicitSave);
    
    // Cmd+/ 或 Ctrl+/：注释/取消注释当前行
    editor.addCommand(
      monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.Slash,
      () => editor.trigger('keyboard', 'editor.action.commentLine', {})
    );
    
    // Alt+F：格式化文档
    editor.addCommand(
      monacoApi.Alt | monacoApi.KeyCode.F,
      () => editor.trigger('keyboard', 'editor.action.formatDocument', {})
    );
    
    // Cmd+D：选中下一个相同单词
    editor.addCommand(
      monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyD,
      () => editor.trigger('keyboard', 'actions.selection.match.findNextMatch', {})
    );
    
    // Ctrl+空格：触发建议/智能感知
    editor.addCommand(
      monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.Space,
      () => editor.trigger('keyboard', 'editor.action.triggerSuggest', {})
    );
  }, [handleExplicitSave]);

  return (
    <Suspense fallback={<div style={{ padding: 24, color: "var(--text-muted)", fontSize: 12 }}>Loading editor...</div>}>
      <LazyEditor
        defaultValue={value}
        language={mapLanguage(language)}
        onChange={handleEditorChange}
        onMount={handleMount}
        options={editorOptions}
      />
    </Suspense>
  );
}