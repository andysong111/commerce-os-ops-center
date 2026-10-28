import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildBridgeManifestV0344 } from "../src/lib/shoplingMarketBridgeManifestV0344.ts";

const oneClick = new URL(
  "../src/app/seo-bulk-cloud/SeoBulkShoplingOneClickControl.tsx",
  import.meta.url,
);

function fixture(contentScripts) {
  return {
    "manifest.json": JSON.stringify({
      version: "0.3.43",
      action: { default_title: "v0.3.43" },
      content_scripts: contentScripts,
    }),
    "content-group-canary.mjs": "void 0;",
    "background-root.mjs": "void 0;",
    "commerce-os-market-auto-bridge.mjs":
      'window.postMessage({type:"commerce-os-shopling-market-auto-probe-ack-v0330",version:"0.3.30"}, location.origin);',
    "shopling-market-auto-agent.mjs":
      'const ACTIVE_KEY = "commerceOsShoplingMarketAutoActiveV0343";',
  };
}

function scripts(manifest, name) {
  return manifest.content_scripts.filter((entry) => entry.js?.includes(name));
}

test("restores the two manifest registrations missing from the shipped v0.3.43 ZIP", () => {
  const base = [
    {
      matches: ["*://*.shopling.co.kr/*", "*://*.cassnet.co.kr/*"],
      js: ["recovery.mjs", "content-group-canary.mjs"],
      all_frames: true,
    },
  ];
  const output = buildBridgeManifestV0344(fixture(base));
  const manifest = JSON.parse(output["manifest.json"]);

  assert.equal(manifest.version, "0.3.44");
  assert.deepEqual(manifest.content_scripts[0], base[0]);
  assert.deepEqual(scripts(manifest, "commerce-os-market-auto-bridge.mjs"), [
    {
      matches: ["https://commerce-os-ops-center.vercel.app/*"],
      js: ["commerce-os-market-auto-bridge.mjs"],
      run_at: "document_idle",
    },
  ]);
  assert.deepEqual(scripts(manifest, "shopling-market-auto-agent.mjs"), [
    {
      matches: ["*://*.shopling.co.kr/*"],
      js: ["shopling-market-auto-agent.mjs"],
      all_frames: false,
      run_at: "document_idle",
    },
  ]);
});

test("deduplicates stale bridge entries instead of injecting multiple agents", () => {
  const output = buildBridgeManifestV0344(
    fixture([
      {
        matches: ["https://commerce-os-ops-center.vercel.app/*"],
        js: ["commerce-os-market-auto-bridge.mjs"],
      },
      {
        matches: ["*://*.shopling.co.kr/*"],
        js: ["shopling-market-auto-agent.mjs"],
      },
    ]),
  );
  const manifest = JSON.parse(output["manifest.json"]);
  assert.equal(scripts(manifest, "commerce-os-market-auto-bridge.mjs").length, 1);
  assert.equal(scripts(manifest, "shopling-market-auto-agent.mjs").length, 1);
});

test("fails closed when either bridge asset is absent", () => {
  const missingBridge = fixture([]);
  delete missingBridge["commerce-os-market-auto-bridge.mjs"];
  assert.throws(
    () => buildBridgeManifestV0344(missingBridge),
    /v0344_missing_asset:commerce-os-market-auto-bridge\.mjs/,
  );
});

test("one-click UI links the fixed package and supports a no-send connection check", async () => {
  const source = await readFile(oneClick, "utf8");
  assert.match(source, /v0344\/download/);
  assert.match(source, /최신 확장 v0\.3\.44 다운로드/);
  assert.match(source, /연결 다시 확인/);
  assert.match(source, /void checkBridge\(\)/);
});
