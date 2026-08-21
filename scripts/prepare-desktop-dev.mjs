import { cp, mkdir, open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = join(root, "desktop-dist");
const frontendRoot = join(root, "src-tauri", "frontend");

await mkdir(join(runtimeRoot, "server"), { recursive: true });
const placeholder = await open(join(runtimeRoot, process.platform === "win32" ? "node.exe" : "node"), "a");
await placeholder.close();
await mkdir(join(frontendRoot, "icons"), { recursive: true });
await cp(join(root, "public", "icons", "icon-192.png"), join(frontendRoot, "icons", "icon-192.png"));
