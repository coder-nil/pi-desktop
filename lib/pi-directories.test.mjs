import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ensurePiAgentsDirectory } from "./pi-directories.ts";

test("creates ~/.pi/agents when it does not exist", async () => {
  const homeDirectory = await mkdtemp(join(tmpdir(), "pi-desktop-home-"));

  try {
    await ensurePiAgentsDirectory(homeDirectory);
    await writeFile(join(homeDirectory, ".pi", "agents", "marker"), "created");

    assert.equal(
      await readFile(join(homeDirectory, ".pi", "agents", "marker"), "utf8"),
      "created",
    );
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

test("leaves an existing ~/.pi/agents directory intact", async () => {
  const homeDirectory = await mkdtemp(join(tmpdir(), "pi-desktop-home-"));

  try {
    await ensurePiAgentsDirectory(homeDirectory);
    await writeFile(join(homeDirectory, ".pi", "agents", "marker"), "preserved");

    await ensurePiAgentsDirectory(homeDirectory);

    assert.equal(
      await readFile(join(homeDirectory, ".pi", "agents", "marker"), "utf8"),
      "preserved",
    );
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});
