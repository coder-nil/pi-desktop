import { NextResponse } from "next/server";
import type { AppUpdateResponse } from "@/lib/api-types";
import {
  compareVersions,
  getPiDesktopReleaseUrl,
  isNewerVersion,
  normalizeVersion,
} from "@/lib/app-update";

export const dynamic = "force-dynamic";

const CURRENT_VERSION = process.env.NEXT_PUBLIC_PACKAGE_VERSION ?? "0.0.0";
const GITHUB_RELEASES_URL = "https://api.github.com/repos/mafousoftware/pi-desktop/releases?per_page=20";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

interface GitHubRelease {
  draft?: unknown;
  html_url?: unknown;
  tag_name?: unknown;
}

interface AppUpdateCache {
  value?: AppUpdateResponse;
  expiresAt: number;
  inFlight?: Promise<AppUpdateResponse>;
}

declare global {
  var __piDesktopAppUpdateCache: AppUpdateCache | undefined;
}

function getCache(): AppUpdateCache {
  return globalThis.__piDesktopAppUpdateCache ??= { expiresAt: 0 };
}

async function fetchLatestVersion(): Promise<AppUpdateResponse> {
  const response = await fetch(GITHUB_RELEASES_URL, {
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Pi-Desktop-Updater",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GitHub Releases returned HTTP ${response.status}`);

  const body = await response.json() as unknown;
  if (!Array.isArray(body)) throw new Error("GitHub Releases returned an invalid response");

  let latest: { version: string; releaseUrl: string } | null = null;
  for (const item of body as GitHubRelease[]) {
    if (item.draft === true || typeof item.tag_name !== "string") continue;
    const version = normalizeVersion(item.tag_name);
    if (!version) continue;

    const releaseUrl = typeof item.html_url === "string"
      ? item.html_url
      : getPiDesktopReleaseUrl(version);
    if (!releaseUrl) continue;
    if (!latest || compareVersions(version, latest.version) === 1) {
      latest = { version, releaseUrl };
    }
  }
  if (!latest) throw new Error("GitHub Releases did not contain a valid version");

  return {
    currentVersion: CURRENT_VERSION,
    latestVersion: latest.version,
    updateAvailable: isNewerVersion(latest.version, CURRENT_VERSION),
    releaseUrl: latest.releaseUrl,
  };
}

async function loadUpdateStatus(forceRefresh: boolean): Promise<AppUpdateResponse> {
  const cache = getCache();
  if (!forceRefresh && cache.value && cache.expiresAt > Date.now()) return cache.value;
  if (!cache.inFlight) {
    cache.inFlight = fetchLatestVersion().then((value) => {
      cache.value = value;
      cache.expiresAt = Date.now() + CACHE_TTL_MS;
      return value;
    }).finally(() => {
      cache.inFlight = undefined;
    });
  }

  try {
    return await cache.inFlight;
  } catch (error) {
    if (!forceRefresh && cache.value) return cache.value;
    throw error;
  }
}

export async function GET(request: Request) {
  try {
    const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";
    return NextResponse.json(await loadUpdateStatus(forceRefresh));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
