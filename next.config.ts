import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const configDir = dirname(fileURLToPath(import.meta.url));
const buildTarget = process.env.PI_WEB_BUILD_TARGET;
const isDesktopFrontendBuild = buildTarget === "desktop-frontend";
const distDir = isDesktopFrontendBuild
  ? ".next-desktop-frontend"
  : buildTarget === "desktop-dev"
    ? ".next-desktop-dev"
    : ".next";
let piVersion = "unknown";
let packageVersion = "0.0.0";
try {
  const piPkgPath = join(configDir, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }
try {
  const packagePath = join(configDir, "package.json");
  packageVersion = (JSON.parse(readFileSync(packagePath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

const nextConfig: NextConfig = {
  output: isDesktopFrontendBuild ? "export" : "standalone",
  distDir,
  outputFileTracingRoot: configDir,
  images: { unoptimized: true },
  serverExternalPackages: [
    "undici",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
  ],
  allowedDevOrigins: ["127.0.0.1", "192.168.*.*"],
  async headers() {
    if (isDesktopFrontendBuild) return [];
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
  env: {
    // Keep the UI's branded release label independent from the npm/Tauri semver.
    NEXT_PUBLIC_APP_VERSION: "alpha.3",
    NEXT_PUBLIC_PACKAGE_VERSION: packageVersion,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default nextConfig;
