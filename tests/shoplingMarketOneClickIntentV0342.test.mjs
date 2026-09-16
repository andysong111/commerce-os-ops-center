import assert from "node:assert/strict";
import test from "node:test";
import { buildOneClickIntentV0342 } from "../src/lib/shoplingMarketOneClickIntentV0342.ts";

function sourceFixture() {
  return {
    "content-group-canary.mjs": [
      'const QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0341";',
      'const INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0341";',
      'const submit_armed = true;',
      'const selectedMallIds = [1];',
    ].join("\n"),
    "background-root.mjs": [
      'const DIRECT_RESULT_MAX_ATTEMPTS = 240;',
      'const RESULT_RE = /prod_rgst_(?:rspt|trsmt|tsrmt)/;',
    ].join("\n"),
    "popup.js": 'const version = "0.3.41";',
    "popup.html": '<div>0.3.41</div>',
    "recovery.mjs": 'const version = "0.3.41";',
    "shopling-market-auto-agent.mjs": [
      'globalThis.__commerceOsShoplingMarketAutoAgentV0330 = true;',
      'const QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0330";',
      'const INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0330";',
      'const ACTIVE_KEY = "commerceOsShoplingMarketAutoActiveV0330";',
      'const BG_TICK = "commerce-os-shopling-market-auto-bg-tick-v0330";',
      'const BG_HEARTBEAT = "commerce-os-shopling-market-auto-bg-heartbeat-v0330";',
      'const BG_REPORT = "commerce-os-shopling-market-auto-bg-report-v0330";',
      'const intent = {',
      '  version: "0.3.30",',
      '  status: "pending",',
      '};',
    ].join("\n"),
    "manifest.json": JSON.stringify({ version: "0.3.41", action: {} }),
    "VERSION.txt": "0.3.41\n",
    "README.txt": "v0.3.41\n",
  };
}

test("v0.3.42 one-click agent writes the same current queue/intent keys as the A18 runner", () => {
  const output = buildOneClickIntentV0342(sourceFixture());
  const manifest = JSON.parse(output["manifest.json"]);
  const agent = output["shopling-market-auto-agent.mjs"];
  const content = output["content-group-canary.mjs"];
  assert.equal(manifest.version, "0.3.42");
  for (const key of [
    "commerceOsShoplingMarketSelectionQueueV0342",
    "commerceOsShoplingMarketSelectionIntentV0342",
  ]) {
    assert.ok(agent.includes(key), `auto agent missing ${key}`);
    assert.ok(content.includes(key), `A18 runner missing ${key}`);
  }
  assert.ok(agent.includes("commerceOsShoplingMarketAutoActiveV0342"));
  assert.ok(!agent.includes("commerceOsShoplingMarketSelectionQueueV0330"));
  assert.ok(!agent.includes("commerceOsShoplingMarketSelectionIntentV0330"));
});

test("v0.3.42 keeps the durable v0330 server handoff protocol while replacing only stale local state", () => {
  const output = buildOneClickIntentV0342(sourceFixture());
  const agent = output["shopling-market-auto-agent.mjs"];
  for (const marker of [
    "commerce-os-shopling-market-auto-bg-tick-v0330",
    "commerce-os-shopling-market-auto-bg-heartbeat-v0330",
    "commerce-os-shopling-market-auto-bg-report-v0330",
  ]) assert.ok(agent.includes(marker));
});

test("v0.3.42 retains v0.3.41 result readback and fail-closed submit protection", () => {
  const output = buildOneClickIntentV0342(sourceFixture());
  const background = output["background-root.mjs"];
  const content = output["content-group-canary.mjs"];
  assert.ok(background.includes("prod_rgst_(?:rspt|trsmt|tsrmt)"));
  assert.ok(background.includes("DIRECT_RESULT_MAX_ATTEMPTS = 240"));
  assert.ok(content.includes("submit_armed"));
  assert.ok(content.includes("selectedMallIds") || content.includes("mallIds"));
});
