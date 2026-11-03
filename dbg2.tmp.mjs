import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { readFileSync } = await import("node:fs");
const disk = JSON.parse(readFileSync(process.env.HOME + "/.pi/agent/desktop-session-index.json", "utf8"));
console.log("disk version:", disk.version, "entries:", Object.keys(disk.entries).length);
const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
console.log("getAgentDir:", getAgentDir());
// 用与模块相同的逻辑检查 key 匹配
const { sessionPathKey } = await jiti.import("./lib/session-path.ts");
const keys = Object.keys(disk.entries);
console.log("key[0] normalized same:", sessionPathKey(keys[0]) === keys[0]);
console.log("key[0]:", keys[0].slice(-60));
const { statSync } = await import("node:fs");
let hit = 0, miss = 0;
for (const k of keys) {
  try {
    const s = statSync(k);
    const e = disk.entries[k];
    if (s.size === e.size && s.mtimeMs === e.mtimeMs) hit++; else { miss++; if (miss <= 3) console.log("MISS", s.size, e.size, s.mtimeMs, e.mtimeMs); }
  } catch { miss++; }
}
console.log("disk-cache hit:", hit, "miss:", miss);
