import type { AgentMessage } from "./types";

/**
 * 手机遥控页的纯文本投影。
 *
 * 手机上不渲染 markdown / 代码高亮 / 图片，所以这里把会话消息压成
 * 「谁说了什么 + 工具调用一行」。规则尽量保守：只保留人能快速扫读的信息。
 */

export interface MobileMessage {
  /** 会话条目 id，作为列表 key；流式尾巴用 `live`。 */
  id: string;
  role: "user" | "assistant";
  text: string;
  /** 折叠成 `▸ name hint` 的工具调用。 */
  tools?: string[];
  at?: string;
}

const MAX_MESSAGE_CHARS = 1500;
const MAX_TOOL_HINT_CHARS = 60;

/** 工具调用的可读摘要：`read src/a.ts`、`bash npm test`。 */
export function describeToolCall(name: string, args: unknown): string {
  const hint = toolHint(args);
  return hint ? `${name} ${hint}` : name;
}

function toolHint(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return undefined;
  const record = args as Record<string, unknown>;
  for (const key of ["path", "file_path", "filePath", "command", "pattern", "query", "url", "prompt"]) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const firstLine = value.trim().split("\n", 1)[0]?.trim();
    if (!firstLine) continue;
    return firstLine.length > MAX_TOOL_HINT_CHARS
      ? `${firstLine.slice(0, MAX_TOOL_HINT_CHARS - 3)}...`
      : firstLine;
  }
  return undefined;
}

function truncate(text: string): string {
  return text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}\n…` : text;
}

export function textFromBlocks(blocks: unknown): { text: string; images: number } {
  if (typeof blocks === "string") return { text: blocks, images: 0 };
  if (!Array.isArray(blocks)) return { text: "", images: 0 };

  const parts: string[] = [];
  let images = 0;
  for (const block of blocks) {
    if (typeof block !== "object" || block === null) continue;
    const record = block as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      parts.push(record.text);
    } else if (record.type === "image") {
      images += 1;
    }
  }
  return { text: parts.join("\n").trim(), images };
}

function formatClock(timestamp: unknown): string | undefined {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return undefined;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** 把一条助手消息的 content blocks 压成「正文 + 折叠的工具调用」。 */
export function projectAssistantBlocks(blocks: unknown): { text: string; tools: string[] } {
  const { text } = textFromBlocks(blocks);
  const tools: string[] = [];
  if (Array.isArray(blocks)) {
    for (const block of blocks) {
      if (typeof block !== "object" || block === null) continue;
      const record = block as Record<string, unknown>;
      if (record.type !== "toolCall") continue;
      const name = typeof record.name === "string"
        ? record.name
        : typeof record.toolName === "string"
          ? record.toolName
          : "tool";
      tools.push(describeToolCall(name, record.arguments ?? record.input));
    }
  }
  return { text, tools };
}

/**
 * 把会话消息压成手机端消息列表。
 *
 * `entryIds` 与 `messages` 平行（见 `SessionContext`），用于给每条消息一个稳定 key。
 */
export function toMobileMessages(
  messages: readonly AgentMessage[],
  entryIds: readonly string[] = [],
  limit = 30,
): MobileMessage[] {
  const projected: MobileMessage[] = [];

  messages.forEach((message, index) => {
    const id = entryIds[index] ?? `m${index}`;
    const at = formatClock((message as { timestamp?: unknown }).timestamp);

    if (message.role === "user") {
      const { text, images } = textFromBlocks((message as { content?: unknown }).content);
      const body = [text, images > 0 ? `[${images} image${images > 1 ? "s" : ""}]` : ""]
        .filter(Boolean)
        .join("\n");
      if (!body) return;
      projected.push({ id, role: "user", text: truncate(body), ...(at ? { at } : {}) });
      return;
    }

    if (message.role === "assistant") {
      const { text, tools } = projectAssistantBlocks((message as { content?: unknown }).content);
      if (!text && tools.length === 0) return;
      projected.push({
        id,
        role: "assistant",
        text: truncate(text),
        ...(tools.length > 0 ? { tools } : {}),
        ...(at ? { at } : {}),
      });
      return;
    }

    // 工具结果与思考过程不进手机视图：信息已由工具调用那一行表达。
  });

  return projected.slice(-Math.max(1, limit));
}
