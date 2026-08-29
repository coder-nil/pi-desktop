#!/usr/bin/env node
"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */
const { getUnsupportedNodeVersionMessage, isNodeVersionSupported } = require("./node-version");

if (!isNodeVersionSupported(process.versions.node)) {
  console.error(getUnsupportedNodeVersionMessage(process.versions.node));
  process.exit(1);
}

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { isLoopbackHostname, parseLaunchOptions } = require("./pi-desktop-options");
const { wireChildProcessLifecycle } = require("./process-lifecycle");

const pkgDir = path.join(__dirname, "..");
let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
} catch {
  const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
  nextBin = path.join(path.dirname(nextPkg), "dist", "bin", "next");
}

const rawArgs = process.argv.slice(2);
const { hostname, openBrowser: shouldOpenBrowser, port } = parseLaunchOptions(rawArgs);
if (!isLoopbackHostname(hostname) && !process.env.PI_WEB_PASSWORD) {
  console.error(
    `Refusing to expose pi-desktop on ${hostname} without authentication. Set PI_WEB_PASSWORD to a long random password.`,
  );
  process.exit(1);
}

const passthroughArgs = [];
for (let index = 0; index < rawArgs.length; index += 1) {
  const argument = rawArgs[index];
  if (argument === "--no-open") continue;
  if (["--hostname", "-H", "--port", "-p"].includes(argument)) {
    index += 1;
    continue;
  }
  if (argument.startsWith("--hostname=") || argument.startsWith("--port=")) continue;
  passthroughArgs.push(argument);
}

const nextArgs = ["dev", "-H", hostname, "-p", port, ...passthroughArgs];
const child = spawn(process.execPath, [nextBin, ...nextArgs], {
  cwd: pkgDir,
  stdio: ["inherit", "pipe", "inherit"],
  env: { ...process.env, PI_WEB_HOSTNAME: hostname },
});
wireChildProcessLifecycle(child);

const urlHostname = hostname.includes(":") && !hostname.startsWith("[")
  ? `[${hostname}]`
  : hostname;
const url = `http://${urlHostname}:${port}`;
let browserOpened = false;

function findChromeApp() {
  if (process.platform !== "darwin") return null;

  const candidates = [
    path.join(os.homedir(), "Applications", "Chrome Apps.localized", "Pi Desktop.app"),
    "/Applications/Chrome Apps.localized/Pi Desktop.app",
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function openBrowser() {
  if (process.platform === "darwin") {
    const chromeApp = findChromeApp();
    if (chromeApp) {
      return spawn("open", ["-a", chromeApp, url], { stdio: "ignore", detached: true });
    }
    if (fs.existsSync("/Applications/Google Chrome.app")) {
      return spawn("open", ["-a", "Google Chrome", url], { stdio: "ignore", detached: true });
    }
    return spawn("open", [url], { stdio: "ignore", detached: true });
  }
  if (process.platform === "win32") {
    return spawn(process.env.ComSpec || "cmd.exe", ["/c", "start", "", url], {
      stdio: "ignore",
      detached: true,
    });
  }
  return spawn("xdg-open", [url], { stdio: "ignore", detached: true });
}

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (shouldOpenBrowser && !browserOpened && text.includes("Ready")) {
    browserOpened = true;
    const opener = openBrowser();
    opener.on("error", (error) => {
      console.warn(`Could not open browser automatically: ${error.message}`);
    });
    opener.unref();
  }
});
