import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { scanSessionFiles } = await jiti.import("./lib/session-index.ts");
let t = performance.now();
const files = await scanSessionFiles();
console.log("scanSessionFiles:", (performance.now() - t).toFixed(0) + "ms  files:", files.length);
t = performance.now();
await scanSessionFiles();
console.log("second call:     ", (performance.now() - t).toFixed(0) + "ms");
