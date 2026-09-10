"use client";

import McpIcon from "@lobehub/icons/es/MCP/components/Mono";
import { parseAnsiLine, stripAnsi } from "@/lib/ansi";
import type { ExtensionStatusItem, ExtensionWidgetItem } from "@/lib/types";
import { ExtensionWidgets } from "./ExtensionWidgets";

export function sanitizeExtensionStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

export function formatExtensionStatusLine(statuses: ExtensionStatusItem[]): string {
  return [...statuses]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ text }) => sanitizeExtensionStatusText(text))
    .join(" ");
}

const MCP_STATUS_PREFIX = /^🔌\s*/u;

export function formatExtensionStatusParts(statuses: ExtensionStatusItem[]): Array<{
  key: string;
  text: string;
  icon: "mcp" | null;
}> {
  return [...statuses]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ key, text }) => {
      const sanitized = sanitizeExtensionStatusText(text);
      const plain = stripAnsi(sanitized);
      const isMcpStatus = MCP_STATUS_PREFIX.test(plain);
      return {
        key,
        text: isMcpStatus ? sanitized.replace(MCP_STATUS_PREFIX, "") : sanitized,
        icon: isMcpStatus ? "mcp" : null,
      };
    });
}

export function ExtensionStatusBar({
  statuses,
  widgets = [],
}: {
  statuses: ExtensionStatusItem[];
  widgets?: ExtensionWidgetItem[];
}) {
  if (statuses.length === 0 && widgets.length === 0) return null;

  const statusParts = formatExtensionStatusParts(statuses);
  const plainStatusLine = statusParts.map(({ text }) => stripAnsi(text)).join(" ");

  return (
    <div
      className={`extension-status-shelf${widgets.length > 0 ? " has-widgets" : ""}${statuses.length > 0 ? " has-status" : ""}`}
    >
      {widgets.length > 0 && <ExtensionWidgets widgets={widgets} />}
      {statuses.length > 0 && (
        <div
          role="status"
          className="extension-status-line"
          aria-label={plainStatusLine}
          title={plainStatusLine}
        >
          <span className="extension-status-text">
            {statusParts.map((part, partIndex) => (
              <span key={part.key} className="extension-status-part">
                {partIndex > 0 && <span aria-hidden="true"> </span>}
                {part.icon === "mcp" && <McpIcon size={14} className="extension-status-icon" aria-hidden="true" />}
                {parseAnsiLine(part.text).map((segment, segmentIndex) => (
                  <span key={segmentIndex} style={segment.style}>{segment.text}</span>
                ))}
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
