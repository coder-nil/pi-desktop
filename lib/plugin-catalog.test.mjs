import assert from "node:assert/strict";
import test from "node:test";

const { detectDescriptionLanguage, parsePluginCatalog, parsePiDevCatalog, mergeCatalogEntries, sortPluginCatalog, applyPluginDownloads, collectPluginDownloads } = await import("./plugin-catalog.ts");

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
    { name: "pi-mcp-extension", source: "npm:pi-mcp-extension", description: "other featured", npmUrl: "https://npmjs.com/package/pi-mcp-extension" },
    { name: "pi-mcp-adapter", source: "npm:pi-mcp-adapter", description: "mcp", npmUrl: "https://npmjs.com/package/pi-mcp-adapter" },
  ];
  assert.equal(sortPluginCatalog(entries)[0].name, "pi-mcp-adapter");
  assert.equal(sortPluginCatalog(entries).length, 2);
});

test("sorts by npm usage (monthly downloads) from most to least", () => {
  const entries = [
    { name: "z-plugin", source: "npm:z-plugin", description: "z", npmUrl: "https://npmjs.com/package/z-plugin", monthlyDownloads: 10 },
    { name: "pi-mcp-adapter", source: "npm:pi-mcp-adapter", description: "mcp", npmUrl: "https://npmjs.com/package/pi-mcp-adapter", monthlyDownloads: 900 },
    { name: "a-plugin", source: "npm:a-plugin", description: "a", npmUrl: "https://npmjs.com/package/a-plugin" },
  ];
  assert.deepEqual(sortPluginCatalog(entries).map((entry) => entry.name), ["pi-mcp-adapter", "z-plugin", "a-plugin"]);
  assert.deepEqual(
    sortPluginCatalog([
      { name: "z-plugin", source: "npm:z-plugin", description: "z", npmUrl: "https://npmjs.com/package/z-plugin" },
      { name: "a-plugin", source: "npm:a-plugin", description: "a", npmUrl: "https://npmjs.com/package/a-plugin" },
    ]).map((entry) => entry.name),
    ["a-plugin", "z-plugin"],
  );
});

test("hydrates a catalog with persisted download counts", () => {
  const bundled = [
    { name: "pi-mcp-adapter", source: "npm:pi-mcp-adapter", description: "mcp", npmUrl: "npm:mcp" },
    { name: "other", source: "npm:other", description: "o", npmUrl: "npm:other" },
  ];
  const hydrated = applyPluginDownloads(bundled, { monthly: { "pi-mcp-adapter": 42 }, weekly: { "pi-mcp-adapter": 7 } });
  assert.equal(hydrated.find((entry) => entry.name === "pi-mcp-adapter")?.monthlyDownloads, 42);
  assert.equal(hydrated.find((entry) => entry.name === "pi-mcp-adapter")?.weeklyDownloads, 7);
  assert.equal(hydrated.find((entry) => entry.name === "other")?.monthlyDownloads, undefined);
  // 未知包名不会凭空加入下载量。
  assert.equal(applyPluginDownloads(bundled, { monthly: { unknown: 5 } })[0].monthlyDownloads, undefined);
});

test("collects download counts returned by a registry search", () => {
  const counts = collectPluginDownloads([
    { name: "pi-mcp-adapter", source: "npm:pi-mcp-adapter", description: "mcp", npmUrl: "npm:mcp", monthlyDownloads: 100, weeklyDownloads: 20 },
    { name: "other", source: "npm:other", description: "o", npmUrl: "npm:other" },
  ]);
  assert.deepEqual(counts, { monthly: { "pi-mcp-adapter": 100 }, weekly: { "pi-mcp-adapter": 20 } });
});

test("reads npm download counts from search payloads", () => {
  const entries = parsePluginCatalog({
    objects: [
      {
        package: { name: "pi-mcp-adapter", description: "MCP adapter", keywords: ["pi-package"], links: { npm: "https://npmjs.com/package/pi-mcp-adapter" } },
        downloads: { monthly: 1234, weekly: 321 },
      },
    ],
  });
  assert.equal(entries[0].monthlyDownloads, 1234);
  assert.equal(entries[0].weeklyDownloads, 321);
});

test("parses the official pi.dev catalog and keeps its usage order", () => {
  const html = [
    '<article data-package-card="true" data-package-name="pi-mcp-adapter" data-package-search="mcp" data-package-downloads="1013749" data-package-date="1">',
    '<article data-package-card="true" data-package-name="pi-subagents" data-package-search="subagents" data-package-downloads="455454" data-package-date="2">',
    '<article data-package-card="true" data-package-name="pi-web-access" data-package-search="web" data-package-downloads="429774" data-package-date="3">',
    '<article data-package-card="true" data-package-name="pi-mcp-adapter" data-package-downloads="1" data-package-date="4">',
  ].join("");
  const entries = parsePiDevCatalog(html);
  assert.deepEqual(entries.map((entry) => entry.name), ["pi-mcp-adapter", "pi-subagents", "pi-web-access"]);
  assert.deepEqual(entries.map((entry) => entry.monthlyDownloads), [1013749, 455454, 429774]);
  assert.equal(entries[1].source, "npm:pi-subagents");
});

test("merges npm metadata into the official catalog without touching its order or counts", () => {
  const official = [
    { name: "pi-subagents", source: "npm:pi-subagents", description: "", descriptionLanguage: "en", npmUrl: "npm:pi-subagents", monthlyDownloads: 455454 },
    { name: "pi-web-access", source: "npm:pi-web-access", description: "", descriptionLanguage: "en", npmUrl: "npm:pi-web-access", monthlyDownloads: 429774 },
  ];
  const registry = [
    { name: "pi-web-access", source: "npm:pi-web-access", description: "Web search for Pi", descriptionLanguage: "en", npmUrl: "npm:pi-web-access", monthlyDownloads: 999, publisher: "nicopreme" },
  ];
  const merged = mergeCatalogEntries(official, registry);
  assert.equal(merged[0].description, "");
  assert.equal(merged[1].description, "Web search for Pi");
  assert.equal(merged[1].publisher, "nicopreme");
  // 排序依据始终来自官网，而不是 npm 的同项数。
  assert.equal(merged[1].monthlyDownloads, 429774);
  assert.deepEqual(sortPluginCatalog(merged).map((entry) => entry.name), ["pi-subagents", "pi-web-access"]);
});

test("detects Ukrainian descriptions before translation", () => {
  assert.equal(detectDescriptionLanguage("CLI еталонних правил"), "uk");
  assert.equal(detectDescriptionLanguage("CLI reference rules"), "en");
});
