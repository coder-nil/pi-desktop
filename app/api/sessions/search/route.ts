import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
import { searchSessions } from "@/lib/session-search";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const searchParams = new URL(req.url).searchParams;
  const query = (searchParams.get("q") ?? "").slice(0, 120).trim();
  const parsedLimit = Number.parseInt(searchParams.get("limit") ?? "80", 10);

  if (!query) {
    return NextResponse.json(
      { matches: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const sessions = await listAllSessions();
    const matches = await searchSessions(sessions, query, parsedLimit, req.signal);
    return NextResponse.json(
      { matches },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
