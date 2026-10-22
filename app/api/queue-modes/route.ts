import { NextResponse } from "next/server";
import type { QueueModeSettingsResponse } from "@/lib/api-types";
import { readQueueModes, writeQueueModes, type QueueMode } from "@/lib/queue-mode-settings";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function isQueueMode(value: unknown): value is QueueMode {
  return value === "all" || value === "one-at-a-time";
}

export async function GET(): Promise<NextResponse<QueueModeSettingsResponse | { error: string }>> {
  try {
    return NextResponse.json(await readQueueModes());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request): Promise<NextResponse<QueueModeSettingsResponse | { error: string }>> {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as { steeringMode?: unknown; followUpMode?: unknown };
    if (body.steeringMode !== undefined && !isQueueMode(body.steeringMode)) {
      return NextResponse.json({ error: 'steeringMode must be "all" or "one-at-a-time"' }, { status: 400 });
    }
    if (body.followUpMode !== undefined && !isQueueMode(body.followUpMode)) {
      return NextResponse.json({ error: 'followUpMode must be "all" or "one-at-a-time"' }, { status: 400 });
    }
    if (body.steeringMode === undefined && body.followUpMode === undefined) {
      return NextResponse.json({ error: "Provide steeringMode or followUpMode" }, { status: 400 });
    }
    return NextResponse.json(await writeQueueModes({
      ...(body.steeringMode !== undefined ? { steeringMode: body.steeringMode } : {}),
      ...(body.followUpMode !== undefined ? { followUpMode: body.followUpMode } : {}),
    }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
