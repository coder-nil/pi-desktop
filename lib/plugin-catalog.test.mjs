import assert from "node:assert/strict";
import test from "node:test";

const { detectDescriptionLanguage, parsePluginCatalog, sortPluginCatalog } = await import("./plugin-catalog.ts");

test("parses Pi packages and keeps curated Chinese descriptions", () => {
  const entries = parsePluginCatalog({
    objects: [
      { package: { name: "pi-mcp-adapter", description: "MCP adapter", version: "2.0.0", keywords: ["pi-package"], links: { npm: "https://npmjs.com/package/pi-mcp-adapter" } } },
      { package: { name: "not-a-pi-package", description: "Other", keywords: ["mcp"] } },
    ],
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].source, "npm:pi-mcp-adapter");
  assert.match(entries[0].descriptionZh, /MCP/);
});

test("sorts featured packages before the rest", () => {
  const entries = [
    { name: "z-plugin", source: "npm:z-plugin", description: "z", npmUrl: "https://npmjs.com/package/z-plugin" },
    { name: "pi-mcp-adapter", source: "npm:pi-mcp-adapter", description: "mcp", npmUrl: "https://npmjs.com/package/pi-mcp-adapter" },
  ];
  assert.equal(sortPluginCatalog(entries)[0].name, "pi-mcp-adapter");
});

test("detects Ukrainian descriptions before translation", () => {
  assert.equal(detectDescriptionLanguage("CLI еталонних правил"), "uk");
  assert.equal(detectDescriptionLanguage("CLI reference rules"), "en");
});
