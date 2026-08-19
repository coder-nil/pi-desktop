import { NextResponse } from "next/server";
import { mkdirSync } from "fs";
import { allowFileRoot } from "@/lib/file-access";
import { DEFAULT_CWD } from "@/lib/default-cwd";

// POST /api/default-cwd
// Ensures the configured default directory exists and returns the path.
export async function POST() {
  try {
    const dir = DEFAULT_CWD;
    mkdirSync(dir, { recursive: true });
    allowFileRoot(dir);
    return NextResponse.json({ cwd: dir });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
