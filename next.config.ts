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
/** 仓库的发布页前缀，与 `src-tauri` 里 `open_release_url` 的白名单一致。 */
const APP_RELEASES_PREFIX = "https://github.com/coder-nil/pi-desktop/releases";
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
  // pi-coding-agent loads these assets through fs at runtime, so Next's static
  // dependency tracing cannot discover them from the JavaScript imports alone.
  // Without explicit includes, the standalone desktop server starts normally
  // but creating/reloading an agent fails when initTheme() reads dark.json.
  outputFileTracingIncludes: isDesktopFrontendBuild ? undefined : {
    "/*": [
      "node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/*.json",
      "node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/assets/*.png",
      "node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/template.*",
      "node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/vendor/*.js",
      // `CHANGELOG.md` 在构建期解析成 `data/changelog.json` 并被打进包里，
      // 但它是通过 JSON import 进来的，standalone 追踪不一定跟着复制，
      // 缺了它关于对话框就只剩版本号。
      "data/changelog.json",
    ],
  },
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
    NEXT_PUBLIC_APP_VERSION: packageVersion,
    NEXT_PUBLIC_PACKAGE_VERSION: packageVersion,
    NEXT_PUBLIC_PI_VERSION: piVersion,
    // 关于对话框里「版本信息」的数据源，与 POST /api/app-update 使用的
    // `/api/app-update` 发布页地址保持一致。
    NEXT_PUBLIC_APP_RELEASES_URL: `${APP_RELEASES_PREFIX}?per_page=20`,
  },
};

export default nextConfig;
