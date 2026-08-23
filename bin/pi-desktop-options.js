"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isIP } = require("node:net");

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function isEnabled(value) {
  return typeof value === "string" && TRUE_VALUES.has(value.trim().toLowerCase());
}

function normalizePort(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error("Port must be a non-negative integer.");
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65535) {
    throw new Error("Port must be between 0 and 65535.");
  }

  return String(port);
}

function isLoopbackHostname(value) {
  const trimmed = value.trim().toLowerCase().replace(/\.$/, "");
  const hostname = trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (isIP(hostname) === 4) return hostname.startsWith("127.");
  if (isIP(hostname) !== 6) return false;
  if (hostname === "::1" || hostname === "0:0:0:0:0:0:0:1") return true;

  const mappedIpv4 = hostname.match(/^(?:::ffff:|0:0:0:0:0:ffff:)(.+)$/)?.[1];
  if (!mappedIpv4) return false;
  if (mappedIpv4.startsWith("127.")) return true;
  const firstHexGroup = mappedIpv4.split(":", 1)[0];
  return /^[0-9a-f]{1,4}$/.test(firstHexGroup)
    && (Number.parseInt(firstHexGroup, 16) >> 8) === 0x7f;
}

function parseLaunchOptions(args = process.argv.slice(2), env = process.env) {
  const { values: cliArgs } = parseArgs({
    args,
    options: {
      port:      { type: "string", short: "p" },
      hostname:  { type: "string", short: "H" },
      "no-open": { type: "boolean" },
    },
    strict: false,
  });

  return {
    port: normalizePort(cliArgs.port ?? env.PORT ?? "30141"),
    hostname: cliArgs.hostname ?? env.PI_WEB_HOSTNAME ?? "127.0.0.1",
    openBrowser: !cliArgs["no-open"] && !isEnabled(env.PI_WEB_NO_OPEN),
  };
}

module.exports = { isLoopbackHostname, parseLaunchOptions };
