import { NextResponse } from "next/server";
import {
  APPLICATION_VERSION,
  CHANGELOG,
  PI_VERSION,
  currentRelease,
} from "@/lib/changelog";

export const dynamic = "force-dynamic";

/**
 * GET /api/changelog —— 关于对话框的数据源。
 *
 * 变更记录是构建期打进包里的常量（见 `lib/changelog.ts`），所以这里没有任何
 * 网络或磁盘访问，离线也能返回完整历史。
 */
export async function GET() {
  return NextResponse.json(
    {
      version: APPLICATION_VERSION,
      piVersion: PI_VERSION,
      current: currentRelease()?.version ?? null,
      releases: CHANGELOG,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
