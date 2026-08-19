#!/usr/bin/env node
"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { wireChildProcessLifecycle } = require("./process-lifecycle");

const pkgDir = path.join(__dirname, "..");
let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
} catch {
  const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
  nextBin = path.join(path.dirname(nextPkg), "dist", "bin", "next");
}

const nextArgs = ["dev", "-H", "127.0.0.1", "-p", "30141", ...process.argv.slice(2)];
const child = spawn(process.execPath, [nextBin, ...nextArgs], {
  cwd: pkgDir,
  stdio: ["inherit", "pipe", "inherit"],
});
wireChildProcessLifecycle(child);

const url = "http://127.0.0.1:30141";
let browserOpened = false;

function findChromeApp() {
  if (process.platform !== "darwin") return null;

  const candidates = [
    path.join(os.homedir(), "Applications", "Chrome Apps.localized", "Pi Web.app"),
    "/Applications/Chrome Apps.localized/Pi Web.app",
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
  if (!browserOpened && text.includes("Ready")) {
    browserOpened = true;
    const opener = openBrowser();
    opener.on("error", (error) => {
      console.warn(`Could not open browser automatically: ${error.message}`);
    });
    opener.unref();
  }
});
