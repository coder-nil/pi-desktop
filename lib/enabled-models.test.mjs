import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  applyProviderSelection,
  buildEnabledModelPatterns,
  isGlobSafeProviderName,
  modelKey,
} = await jiti.import("./enabled-models.ts");

const AVAILABLE = [
  { provider: "deepseek", id: "deepseek-v4-pro" },
  { provider: "deepseek", id: "deepseek-flash" },
  { provider: "anthropic", id: "claude-sonnet-4-6" },
  { provider: "anthropic", id: "claude-opus-4-6" },
];

test("keeps the default 'everything visible' state when all models are selected", () => {
  assert.equal(
    buildEnabledModelPatterns(AVAILABLE, AVAILABLE.map(modelKey)),
    undefined,
  );
});

test("collapses a fully selected provider into a wildcard", () => {
  const selected = ["deepseek/deepseek-v4-pro", "deepseek/deepseek-flash"];
  assert.deepEqual(buildEnabledModelPatterns(AVAILABLE, selected), ["deepseek/*"]);
});

test("hides every model of a provider that is not selected", () => {
  const selected = AVAILABLE.map(modelKey).filter((key) => key.startsWith("anthropic/"));
  assert.deepEqual(buildEnabledModelPatterns(AVAILABLE, selected), ["anthropic/*"]);
});

test("lists individual models when only part of a provider is selected", () => {
  const selected = [
    "deepseek/deepseek-v4-pro",
    "anthropic/claude-sonnet-4-6",
    "anthropic/claude-opus-4-6",
  ];
  assert.deepEqual(buildEnabledModelPatterns(AVAILABLE, selected), [
    "deepseek/deepseek-v4-pro",
    "anthropic/*",
  ]);
});

test("returns an empty list when nothing is selected", () => {
  // 调用方必须拦下这种情况：pi 会把解析不出模型的 pattern 回退成“全部可见”。
  assert.deepEqual(buildEnabledModelPatterns(AVAILABLE, []), []);
});

test("preserves pinned thinking levels", () => {
  const available = [
    { provider: "anthropic", id: "a", thinkingLevel: "high" },
    { provider: "anthropic", id: "b", thinkingLevel: "high" },
    { provider: "deepseek", id: "c" },
  ];
  assert.deepEqual(
    buildEnabledModelPatterns(available, available.map(modelKey)),
    ["anthropic/*:high", "deepseek/*"],
  );
});

test("falls back to explicit entries when pinned levels differ", () => {
  const available = [
    { provider: "anthropic", id: "a", thinkingLevel: "high" },
    { provider: "anthropic", id: "b", thinkingLevel: "low" },
  ];
  assert.deepEqual(buildEnabledModelPatterns(available, available.map(modelKey)), [
    "anthropic/a:high",
    "anthropic/b:low",
  ]);
});

test("avoids wildcards for provider names that contain glob characters", () => {
  const available = [
    { provider: "my[gw]", id: "a" },
    { provider: "my[gw]", id: "b" },
  ];
  assert.equal(isGlobSafeProviderName("my[gw]"), false);
  assert.deepEqual(buildEnabledModelPatterns(available, ["my[gw]/a"]), ["my[gw]/a"]);
});

test("ignores selections that are not available models", () => {
  assert.deepEqual(
    buildEnabledModelPatterns(AVAILABLE, ["deepseek/deepseek-v4-pro", "ghost/model"]),
    ["deepseek/deepseek-v4-pro"],
  );
});

test("never scopes an empty catalog", () => {
  assert.equal(buildEnabledModelPatterns([], []), undefined);
});

test("replaces only the edited provider when merging selections", () => {
  const visible = [
    { provider: "deepseek", id: "old-a" },
    { provider: "deepseek", id: "old-b" },
    { provider: "anthropic", id: "claude-sonnet-4-6" },
  ];
  assert.deepEqual(
    applyProviderSelection({ visible, provider: "deepseek", modelIds: ["new-a", "new-a"] }),
    ["anthropic/claude-sonnet-4-6", "deepseek/new-a"],
  );
});

test("hides a provider entirely when nothing is selected for it", () => {
  const visible = [
    { provider: "deepseek", id: "a" },
    { provider: "anthropic", id: "b" },
  ];
  assert.deepEqual(
    applyProviderSelection({ visible, provider: "deepseek", modelIds: [] }),
    ["anthropic/b"],
  );
});
