import { getRunningRpcSessionsSnapshot, subscribeRunningSessions } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// GET /api/agent/running/events - SSE stream of running sessions and pending
// user prompts. Pushes an update whenever either set may have changed, so the
// sidebar never has to poll.
export async function GET(req: Request) {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const encode = (data: unknown) => {
        const text = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(text));
      };

      // Subscribe BEFORE taking the initial snapshot so no state change can slip
      // through the gap between snapshot and subscription.
      const unsubscribe = subscribeRunningSessions((snapshot) => {
        try {
          encode({ type: "running", ...snapshot });
        } catch {
          // controller already closed
        }
      });

      // Initial snapshot so the client renders the correct state immediately.
      // (A duplicate frame here is harmless: the client just sets the same set.)
      encode({ type: "running", ...getRunningRpcSessionsSnapshot() });

      // Heartbeat to keep the connection alive through proxies/timeouts.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          // controller already closed
        }
      }, 30_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      };

      req.signal?.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
