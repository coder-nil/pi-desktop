import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "@/lib/file-access";
import { isApiRequestAllowed } from "@/lib/request-security";
import { isFilePathReferencedBySession } from "@/lib/session-file-references";

const execute = promisify(execFile);

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body.filePath !== "string" || !path.isAbsolute(body.filePath) || body.filePath.includes("\0")) {
    return Response.json({ error: "Invalid file path" }, { status: 400 });
  }
  const filePath = path.normalize(body.filePath);
  const roots = await getAllowedFileRoots();
  const allowedByRoot = isFilePathAllowed(filePath, roots);
  const allowedByReference = !allowedByRoot && await isFilePathReferencedBySession(
    filePath, typeof body.sessionId === "string" ? body.sessionId : null,
  );
  if (!allowedByRoot && !allowedByReference) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }
  let info;
  try {
    info = await stat(filePath);
  } catch {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (!allowedByReference && !isExistingFilePathAllowed(filePath, roots)) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }
  try {
    const options = { timeout: 10_000, windowsHide: true };
    if (process.platform === "darwin") {
      await execute("/usr/bin/open", info.isDirectory() ? [filePath] : ["-R", filePath], options);
    } else if (process.platform === "win32") {
      await execute("explorer.exe", info.isDirectory() ? [filePath] : ["/select,", filePath], options);
    } else if (process.platform === "linux") {
      await execute("xdg-open", [info.isDirectory() ? filePath : path.dirname(filePath)], options);
    } else {
      return Response.json({ error: "Unsupported platform" }, { status: 501 });
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Could not open file manager" }, { status: 500 });
  }
}
