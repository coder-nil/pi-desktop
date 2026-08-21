import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { buildSessionTitleAgentOptions } from "./session-title";

const COMMIT_MESSAGE_TIMEOUT_MS = 90_000;
const MAX_COMMIT_MESSAGE_LENGTH = 160;

const COMMIT_MESSAGE_PROMPT = `Write one concise Git commit message for the staged diff below.

Requirements:
- Describe the change, not the act of reviewing it.
- Use an imperative subject line of at most 72 characters when practical.
- Do not call tools.
- Return only the commit message as plain text, without quotes, labels, markdown, or explanation.

Staged diff:
`;

export function parseGeneratedCommitMessage(raw: string): string {
  let message = raw.trim();
  const fenced = message.match(/^```(?:text)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) message = fenced[1].trim();
  message = message.split(/\r?\n/, 1)[0] ?? "";
  message = message.replace(/^(?:commit\s+message|message|提交说明)\s*[:：-]\s*/i, "").trim();
  message = message.replace(/^['"`]|['"`]$/g, "").trim();
  if (!/[\p{L}\p{N}]/u.test(message)) throw new Error("The model did not return a usable commit message");
  return Array.from(message).slice(0, MAX_COMMIT_MESSAGE_LENGTH).join("").trim();
}

function generatedAssistantText(messages: AgentMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    if (message.stopReason === "error") throw new Error(message.errorMessage || "The commit-message model request failed");
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  throw new Error("The model did not return a commit message");
}

/** Uses the selected session's model in a temporary agent without writing to its history. */
export async function generateCommitMessage(source: AgentSession, stagedDiff: string): Promise<string> {
  const sourceAgent = source.agent;
  await sourceAgent.waitForIdle();
  const options = buildSessionTitleAgentOptions(sourceAgent);
  options.initialState = {
    ...options.initialState!,
    tools: [],
    messages: [],
  };
  const temporaryAgent = new Agent(options);
  const runPromise = temporaryAgent.prompt(`${COMMIT_MESSAGE_PROMPT}${stagedDiff}`);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      runPromise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          temporaryAgent.abort();
          reject(new Error("Commit-message generation timed out"));
        }, COMMIT_MESSAGE_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    temporaryAgent.abort();
    await runPromise.catch(() => {});
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  return parseGeneratedCommitMessage(generatedAssistantText(temporaryAgent.state.messages));
}
