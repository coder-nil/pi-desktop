import type { AgentMessage, CustomMessage } from "./types";

/**
 * Server-side paging for the chat history.
 *
 * A long session used to be shipped to the browser in one JSON payload and then
 * walked end-to-end on every render, which is what made a slow machine show
 * nothing right after sending a prompt. The history is now fetched as a tail
 * window that grows backwards on demand, so both the payload and the render
 * pass are bounded by the window rather than by the session length.
 */

/** Messages per page. Large enough that a normal session still arrives in one piece. */
export const SESSION_PAGE_SIZE = 120;
export const SESSION_PAGE_MAX = 400;

export function clampSessionPageSize(limit: unknown, fallback = SESSION_PAGE_SIZE): number {
  const parsed = typeof limit === "string" ? Number.parseInt(limit, 10) : typeof limit === "number" ? limit : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), SESSION_PAGE_MAX);
}

/**
 * A turn starts at a user prompt — or at a compaction summary, because pi drops
 * the original prompt when it compacts mid-turn. Page boundaries must land on
 * these or a turn is cut in half and its process group renders as loose
 * messages.
 *
 * Kept dependency-free so the paging helpers stay unit-testable; the renderer
 * imports this one (`components/ChatWindow.tsx` uses it through
 * `lib/chat-render-units.ts`).
 */
export function isGroupAnchorMessage(message: AgentMessage | undefined): boolean {
  if (!message) return false;
  if (message.role === "user") return true;
  return message.role === "custom" && (message as CustomMessage).customType === "compaction";
}

/**
 * Walks a window start backwards to the nearest turn boundary so a page never
 * begins in the middle of a turn. Returns 0 when no boundary exists above it.
 */
export function alignWindowStart(messages: AgentMessage[], startIndex: number): number {
  const from = Math.max(0, Math.min(startIndex, messages.length));
  if (from === 0) return 0;
  if (isGroupAnchorMessage(messages[from])) return from;
  for (let index = from; index > 0; index -= 1) {
    if (isGroupAnchorMessage(messages[index - 1])) return index - 1;
  }
  return 0;
}

export interface ContextWindow {
  messages: AgentMessage[];
  entryIds: string[];
  /** Index of the first returned message inside the full context. */
  startIndex: number;
  /** True when messages above the window were left out. */
  hasEarlier: boolean;
  /** Full context size, not the returned length. */
  totalMessages: number;
}

export interface ContextLike {
  messages: AgentMessage[];
  entryIds: string[];
}

function sliceWindow(context: ContextLike, startIndex: number, endIndex: number): ContextWindow {
  const totalMessages = context.messages.length;
  const alignedStart = alignWindowStart(context.messages, startIndex);
  const end = Math.max(alignedStart, Math.min(endIndex, totalMessages));
  return {
    messages: context.messages.slice(alignedStart, end),
    entryIds: context.entryIds.slice(alignedStart, end),
    startIndex: alignedStart,
    hasEarlier: alignedStart > 0,
    totalMessages,
  };
}

/** The newest `limit` messages, aligned back to a turn boundary. */
export function tailContextWindow(context: ContextLike, limit = SESSION_PAGE_SIZE): ContextWindow {
  const totalMessages = context.messages.length;
  const startIndex = Math.max(0, totalMessages - clampSessionPageSize(limit));
  return sliceWindow(context, startIndex, totalMessages);
}

/**
 * The page directly above `beforeEntryId` (exclusive). Returns an empty window
 * with `hasEarlier: false` when the anchor entry is gone — a stale client must
 * not be told there is more history above a window it cannot reach.
 */
export function earlierContextWindow(
  context: ContextLike,
  beforeEntryId: string | null | undefined,
  limit = SESSION_PAGE_SIZE,
): ContextWindow {
  if (!beforeEntryId) return { messages: [], entryIds: [], startIndex: 0, hasEarlier: false, totalMessages: context.messages.length };
  const position = context.entryIds.indexOf(beforeEntryId);
  if (position < 0) return { messages: [], entryIds: [], startIndex: 0, hasEarlier: false, totalMessages: context.messages.length };
  const startIndex = Math.max(0, position - clampSessionPageSize(limit));
  return sliceWindow(context, startIndex, position);
}

/**
 * Prepends an older page and drops anything already loaded, so a refresh that
 * raced with the fetch cannot duplicate history. Keeps `entryIds` parallel.
 */
export function prependContextPage(
  current: ContextLike,
  page: ContextLike,
): { messages: AgentMessage[]; entryIds: string[]; prepended: number } {
  if (page.entryIds.length === 0 || page.messages.length === 0) {
    return { messages: current.messages, entryIds: current.entryIds, prepended: 0 };
  }
  const known = new Set(current.entryIds);
  const additions: number[] = [];
  for (let index = 0; index < page.entryIds.length; index += 1) {
    if (!known.has(page.entryIds[index])) additions.push(index);
  }
  if (additions.length === 0) {
    return { messages: current.messages, entryIds: current.entryIds, prepended: 0 };
  }
  return {
    messages: [...additions.map((index) => page.messages[index]), ...current.messages],
    entryIds: [...additions.map((index) => page.entryIds[index]), ...current.entryIds],
    prepended: additions.length,
  };
}
