import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("scopes Next.js output file tracing to the pi-desktop package", async () => {
  const config = await createJiti(import.meta.url).import("../next.config.ts", { default: true });

  assert.equal(config.outputFileTracingRoot, projectRoot);
});

test("emits a standalone server for desktop packaging", async () => {
  const config = await createJiti(import.meta.url).import("../next.config.ts", { default: true });
  assert.equal(config.output, "standalone");
});

test("prevents the application UI from being embedded", async () => {
  const config = await createJiti(import.meta.url).import("../next.config.ts", { default: true });
  const rules = await config.headers();
  const rootRule = rules.find((rule) => rule.source === "/");
  const headers = new Map(rootRule?.headers.map(({ key, value }) => [key, value]));

  assert.equal(headers.get("X-Frame-Options"), "DENY");
  assert.match(headers.get("Content-Security-Policy") ?? "", /frame-ancestors 'none'/);
});
