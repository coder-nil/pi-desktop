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
    <linearGradient id="plate" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#34363b"/>
      <stop offset="1" stop-color="#222327"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#plate)"/>
  <rect x="0" y="0" width="1024" height="5" fill="#3b3d43"/>
  <rect x="244" y="312" width="440" height="96" fill="#f4f0e6"/>
  <rect x="244" y="312" width="440" height="6" fill="#fdfaf2"/>
  <rect x="340" y="408" width="96" height="340" fill="#f4f0e6"/>
  <rect x="340" y="408" width="96" height="6" fill="#fdfaf2"/>
  <rect x="544" y="408" width="96" height="340" fill="#f4f0e6"/>
  <rect x="544" y="408" width="96" height="6" fill="#fdfaf2"/>
  <rect x="684" y="276" width="96" height="132" fill="#b8f920"/>
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
