import { stripAnsi } from "./ansi";

const TERMINAL_FRAME_RE = /\x1B\[1G\x1B\[J/g;
const SPINNER_LINE_RE = /^(?:Parsing source|Cloning repository|Downloading source|Discovering skills|Installing skills)[.\u2026]*$/;

/** Convert the skills CLI's animated terminal output into useful API text. */
export function formatSkillCommandOutput(raw: string): string {
  const lines = stripAnsi(raw.replace(TERMINAL_FRAME_RE, "\n"))
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !SPINNER_LINE_RE.test(line));

  return lines.filter((line, index) => line !== lines[index - 1]).join("\n").slice(-4_000);
}
