import { NextResponse } from "next/server";
import { listAddedProjects, removeAddedProject } from "@/lib/added-projects-store";
import { allowFileRoot } from "@/lib/file-access";

export const dynamic = "force-dynamic";

// GET /api/projects lists directories explicitly added by the user.
export async function GET() {
  try {
    const projects = listAddedProjects();
    // The records survive a server restart, unlike the in-memory root cache.
    projects.forEach((project) => {
      allowFileRoot(project.projectRoot);
      allowFileRoot(project.cwd);
    });
    return NextResponse.json({ projects }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/projects body: { projectKey }. This never deletes files or sessions.
export async function DELETE(req: Request) {
  try {
    const body = await req.json() as { projectKey?: unknown };
    const projectKey = typeof body.projectKey === "string" ? body.projectKey.trim() : "";
    if (!projectKey) {
      return NextResponse.json({ error: "projectKey is required" }, { status: 400 });
    }
    return NextResponse.json({ success: true, removed: removeAddedProject(projectKey) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
