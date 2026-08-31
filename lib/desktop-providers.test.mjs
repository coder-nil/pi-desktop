import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createDesktopModelRuntime } = await jiti.import("./desktop-providers.ts");

test("registers Coding as a built-in API-key provider", async () => {
  const runtime = await createDesktopModelRuntime({ modelsPath: null });
  const provider = runtime.getProvider("apisets");
  const config = runtime.getRegisteredProviderConfig("apisets");

  assert.equal(provider?.name, "Coding");
  assert.equal(provider?.baseUrl, "https://coding.apisets.com");
  assert.equal(config?.api, "anthropic-messages");
  assert.equal(Boolean(provider?.auth.apiKey?.login), true);
  assert.equal(provider?.auth.oauth, undefined);
});
