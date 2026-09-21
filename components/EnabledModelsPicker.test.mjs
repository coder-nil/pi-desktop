import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { EnabledModelsPicker } = await jiti.import("./EnabledModelsPicker.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const pickerSource = await readFile(new URL("./EnabledModelsPicker.tsx", import.meta.url), "utf8");
const modelsConfigSource = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");
const routeSource = await readFile(
  new URL("../app/api/models-config/enabled/route.ts", import.meta.url),
  "utf8",
);

function render(props) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(EnabledModelsPicker, props)),
  );
}

test("renders the picker section before the model list arrives", () => {
  const html = render({ providerId: "deepseek" });

  assert.match(html, /Model picker/);
  assert.match(html, /Loading models/);
});

test("every provider detail exposes the model picker", () => {
  for (const detail of ["function OAuthDetail", "function ApiKeyDetail", "function ProviderDetail"]) {
    const start = modelsConfigSource.indexOf(detail);
    assert.ok(start > 0, `${detail} exists`);
    const body = modelsConfigSource.slice(start);
    const nextFunction = body.indexOf("\nfunction ", 1);
    const scope = nextFunction > 0 ? body.slice(0, nextFunction) : body;
    assert.match(scope, /<EnabledModelsPicker/, `${detail} renders the picker`);
  }
  // models.json 保存后自定义服务商才出现在运行时里，需要重新拉取一次。
  assert.match(modelsConfigSource, /<EnabledModelsPicker providerId=\{name\} reloadKey=\{savedTick\}/);
});

test("picker changes refresh the chat model list", () => {
  assert.match(modelsConfigSource, /onModelsChanged=\{onSaved\}/g);
  assert.equal(
    Array.from(modelsConfigSource.matchAll(/onModelsChanged=\{onSaved\}/g)).length,
    3,
    "oauth, api key and custom provider all forward onSaved",
  );
  assert.match(pickerSource, /onChanged\?\.\(\);/);
});

test("saves are serialized so fast clicks cannot overwrite each other", () => {
  assert.match(pickerSource, /saveChainRef\.current = saveChainRef\.current\s*\n?\s*\.then\(\(\) => persist\(\)\)/);
});

test("route refuses to write a scope that would resolve to nothing", () => {
  assert.match(routeSource, /if \(nextPatterns && nextPatterns\.length === 0\)/);
  assert.match(routeSource, /settings\.setEnabledModels\(nextPatterns\)/);
  assert.match(routeSource, /await settings\.flush\(\)/);
  // 模型选择列表缓存 60 秒，写完后必须让它失效。
  assert.match(routeSource, /invalidateModelsCache\(\)/);
});

test("route validates the requested models against the provider", () => {
  assert.match(routeSource, /Unknown models for/);
  assert.match(routeSource, /No available models for/);
});
