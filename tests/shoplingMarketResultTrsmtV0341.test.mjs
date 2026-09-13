import test from "node:test";
import assert from "node:assert/strict";
import { buildResultTrsmtV0341 } from "../src/lib/shoplingMarketResultTrsmtV0341.ts";

function fixture() {
  return {
    "manifest.json": JSON.stringify({ manifest_version: 3, version: "0.3.40", description: "old", action: { default_title: "old" } }),
    "background-root.mjs": `
const RE = /\\/prod_a\\/prod_rgst_(?:rspt|tsrmt)\\.phtml$/i;
const SELECTED_STATUS_API_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-market-group-canary/v0339/status";
const DIRECT_RESULT_MAX_ATTEMPTS = 240;
globalThis.ShoplingRecoveryV0340={};`,
    "content-group-canary.mjs": `(() => { const VERSION="0.3.40"; const RE=/\\/prod_a\\/prod_rgst_(?:rspt|tsrmt)\\.phtml$/i; })();`,
    "popup.js": `const VERSION="0.3.40"; const RE=/\\/prod_a\\/prod_rgst_(?:rspt|tsrmt)\\.phtml$/i;`,
    "popup.html": `<h1>Shopling Market Sender v0.3.40</h1>`,
    "recovery.mjs": `globalThis.ShoplingRecoveryV0340={};`,
    "README.txt": "old",
    "VERSION.txt": "0.3.40",
  };
}

test("v0.3.41 recognizes production trsmt submit-result path", () => {
  const out = buildResultTrsmtV0341(fixture());
  assert.equal(JSON.parse(out["manifest.json"]).version, "0.3.41");
  for (const name of ["background-root.mjs", "content-group-canary.mjs", "popup.js"]) {
    assert.match(out[name], /\(\?:rspt\|trsmt\|tsrmt\)/);
  }
  const actualPath = "/4315/prod_a/prod_rgst_trsmt.phtml";
  const re = /\/prod_a\/prod_rgst_(?:rspt|trsmt|tsrmt)\.phtml$/i;
  assert.equal(re.test(actualPath), true);
});

test("v0.3.41 keeps hardened v0.3.39 status endpoint and long result retry", () => {
  const out = buildResultTrsmtV0341(fixture());
  assert.match(out["background-root.mjs"], /\/v0339\/status/);
  assert.match(out["background-root.mjs"], /DIRECT_RESULT_MAX_ATTEMPTS = 240/);
});
