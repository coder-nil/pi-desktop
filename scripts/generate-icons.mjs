import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicIcons = join(root, "public/icons");
const tauriIcons = join(root, "src-tauri/icons");
const tempRoot = join("/private/tmp", `pi-agents-icons-${process.pid}`);

function appIconSvg(size = 1024) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="face" x1="220" y1="170" x2="800" y2="860" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#59aeb1"/>
      <stop offset="0.52" stop-color="#3f858b"/>
      <stop offset="1" stop-color="#2f6d75"/>
    </linearGradient>
    <linearGradient id="rim" x1="188" y1="144" x2="842" y2="884" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#9de1df"/>
      <stop offset="0.32" stop-color="#5fb8b7"/>
      <stop offset="0.7" stop-color="#317177"/>
      <stop offset="1" stop-color="#1d5057"/>
    </linearGradient>
    <filter id="lift" x="-12%" y="-12%" width="124%" height="124%">
      <feDropShadow dx="0" dy="26" stdDeviation="22" flood-color="#133e45" flood-opacity="0.44"/>
      <feDropShadow dx="-18" dy="-18" stdDeviation="12" flood-color="#c7fffb" flood-opacity="0.58"/>
    </filter>
    <filter id="glyphLift" x="-18%" y="-18%" width="136%" height="136%">
      <feDropShadow dx="0" dy="4" stdDeviation="2.6" flood-color="#194c52" flood-opacity="0.28"/>
    </filter>
  </defs>
  <rect x="122" y="122" width="780" height="780" rx="184" fill="url(#rim)" filter="url(#lift)"/>
  <rect x="142" y="142" width="740" height="740" rx="166" fill="url(#face)"/>
  <path d="M190 182h468c124 0 184 60 184 184v142" fill="none" stroke="#a6ece8" stroke-width="22" stroke-linecap="round" opacity="0.34"/>
  <path d="M842 518v140c0 124-60 184-184 184H390" fill="none" stroke="#1d565e" stroke-width="24" stroke-linecap="round" opacity="0.44"/>
  <text x="512" y="553"
    text-anchor="middle"
    dominant-baseline="middle"
    font-family="Avenir Next, SF Pro Display, Helvetica Neue, Arial, sans-serif"
    font-size="482"
    font-weight="700"
    fill="none"
    stroke="#ffffff"
    stroke-width="34"
    stroke-linejoin="round"
    paint-order="stroke"
    filter="url(#glyphLift)">π</text>
</svg>`;
}

function inputMarkSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="248" height="217" viewBox="0 0 248 217">
  <text x="124" y="108"
    text-anchor="middle"
    dominant-baseline="middle"
    font-family="Avenir Next, SF Pro Display, Helvetica Neue, Arial, sans-serif"
    font-size="228"
    font-weight="600"
    fill="#fff">π</text>
</svg>`;
}

async function pngFromSvg(svg, destination, size) {
  await sharp(Buffer.from(svg))
    .resize(size, size, { fit: "contain" })
    .png()
    .toFile(destination);
}

async function makeIcns() {
  const icnsInput = join(publicIcons, "icon-512.png");
  const icnsOutput = join(tempRoot, "icon.icns");
  await execFileAsync("sips", ["-s", "format", "icns", icnsInput, "--out", icnsOutput]);
  await writeFile(join(tauriIcons, "icon.icns"), await readFile(icnsOutput));
}

async function makeIco(svg) {
  const sizes = [16, 32, 48, 64, 128, 256];
  const images = await Promise.all(
    sizes.map(async (size) => ({
      size,
      buffer: await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer(),
    })),
  );

  const headerSize = 6 + images.length * 16;
  const totalSize = headerSize + images.reduce((sum, image) => sum + image.buffer.length, 0);
  const ico = Buffer.alloc(totalSize);
  ico.writeUInt16LE(0, 0);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(images.length, 4);

  let imageOffset = headerSize;
  for (let index = 0; index < images.length; index += 1) {
    const { size, buffer } = images[index];
    const entryOffset = 6 + index * 16;
    ico.writeUInt8(size === 256 ? 0 : size, entryOffset);
    ico.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
    ico.writeUInt8(0, entryOffset + 2);
    ico.writeUInt8(0, entryOffset + 3);
    ico.writeUInt16LE(1, entryOffset + 4);
    ico.writeUInt16LE(32, entryOffset + 6);
    ico.writeUInt32LE(buffer.length, entryOffset + 8);
    ico.writeUInt32LE(imageOffset, entryOffset + 12);
    buffer.copy(ico, imageOffset);
    imageOffset += buffer.length;
  }

  await writeFile(join(tauriIcons, "icon.ico"), ico);
}

await mkdir(publicIcons, { recursive: true });
await mkdir(tauriIcons, { recursive: true });
await mkdir(tempRoot, { recursive: true });

const iconSvg = appIconSvg();
await pngFromSvg(iconSvg, join(publicIcons, "icon-512.png"), 512);
await pngFromSvg(iconSvg, join(publicIcons, "icon-192.png"), 192);
await pngFromSvg(iconSvg, join(publicIcons, "apple-touch-icon.png"), 180);
await pngFromSvg(iconSvg, join(tauriIcons, "32x32.png"), 32);
await pngFromSvg(iconSvg, join(tauriIcons, "128x128.png"), 128);
await pngFromSvg(iconSvg, join(tauriIcons, "128x128@2x.png"), 256);
await makeIcns();
await makeIco(iconSvg);

await sharp(Buffer.from(inputMarkSvg()))
  .resize(248, 217, { fit: "contain" })
  .png()
  .toFile(join(publicIcons, "pi-input-mark.png"));

await rm(tempRoot, { recursive: true, force: true });
console.log("Generated Pi Desktop app icons.");
