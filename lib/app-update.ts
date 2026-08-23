const SEMVER_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

interface ParsedVersion {
  core: [number, number, number];
  prerelease: string[];
  normalized: string;
}

function parseVersion(version: string): ParsedVersion | null {
  const match = SEMVER_PATTERN.exec(version.trim());
  if (!match) return null;

  const core = match.slice(1, 4).map(Number);
  if (core.some((part) => !Number.isSafeInteger(part))) return null;

  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) {
    return null;
  }

  const normalized = `${core.join(".")}${match[4] ? `-${match[4]}` : ""}${match[5] ? `+${match[5]}` : ""}`;
  return { core: core as [number, number, number], prerelease, normalized };
}

function compareNumericIdentifiers(left: string, right: string): number {
  if (left.length !== right.length) return left.length > right.length ? 1 : -1;
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

export function compareVersions(leftVersion: string, rightVersion: string): number | null {
  const left = parseVersion(leftVersion);
  const right = parseVersion(rightVersion);
  if (!left || !right) return null;

  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] !== right.core[index]) {
      return left.core[index] > right.core[index] ? 1 : -1;
    }
  }

  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }

  const identifierCount = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < identifierCount; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === undefined ? -1 : 1;
    }
    if (leftIdentifier === rightIdentifier) continue;

    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      return compareNumericIdentifiers(leftIdentifier, rightIdentifier);
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier > rightIdentifier ? 1 : -1;
  }

  return 0;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) === 1;
}

export function normalizeVersion(version: string): string | null {
  return parseVersion(version)?.normalized ?? null;
}

export function getPiDesktopReleaseUrl(version: string): string | null {
  const normalized = normalizeVersion(version);
  if (!normalized) return null;
  return `https://github.com/mafousoftware/pi-desktop/releases/tag/v${normalized}`;
}
