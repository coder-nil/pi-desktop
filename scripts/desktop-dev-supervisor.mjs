import { spawn, spawnSync } from "node:child_process";

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const parentPid = Number(option("parent-pid"));
const nextEntry = option("next");
const port = option("port");

if (!Number.isInteger(parentPid) || parentPid <= 0 || !nextEntry || !port) {
  throw new Error("Desktop development supervisor received invalid arguments.");
}

const child = spawn(process.execPath, [nextEntry, "dev", "-H", "127.0.0.1", "-p", port], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    PORT: port,
    PI_WEB_BUILD_TARGET: "desktop-dev",
    PI_WEB_HOSTNAME: "127.0.0.1",
    PI_WEB_NO_OPEN: "1",
  },
  stdio: "inherit",
});

let shuttingDown = false;

function parentIsRunning() {
  try {
    process.kill(parentPid, 0);
    return true;
  } catch {
    return false;
  }
}

function forceKill() {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGKILL");
  }
}

function shutdown(signal = "SIGTERM") {
  if (shuttingDown) {
    forceKill();
    return;
  }
  shuttingDown = true;
  clearInterval(parentWatch);

  if (child.exitCode !== null) {
    process.exit(child.exitCode ?? 0);
  }
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T"], { stdio: "ignore" });
  } else {
    child.kill(signal);
  }
  const forceTimer = setTimeout(forceKill, 5_000);
  forceTimer.unref();
}

const parentWatch = setInterval(() => {
  if (!parentIsRunning()) shutdown();
}, 500);
parentWatch.unref();

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

child.once("exit", (code, signal) => {
  clearInterval(parentWatch);
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.once("error", (error) => {
  console.error(`Could not start the Next.js development server: ${error.message}`);
  process.exit(1);
});
