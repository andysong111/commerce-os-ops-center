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
      'const MARKET_AUTO_BG_HANDOFF = "commerce-os-shopling-market-auto-bg-handoff-v0330";',
      'const MARKET_AUTO_BG_TICK = "commerce-os-shopling-market-auto-bg-tick-v0330";',
      'const MARKET_AUTO_BG_HEARTBEAT = "commerce-os-shopling-market-auto-bg-heartbeat-v0330";',
      'const MARKET_AUTO_BG_REPORT = "commerce-os-shopling-market-auto-bg-report-v0330";',
      'const DIRECT_RESULT_MAX_ATTEMPTS = 240;',
      'const RESULT_RE = /prod_rgst_(?:rspt|trsmt|tsrmt)/;',
      'function handler(message, sendResponse) {',
      '  if ([MARKET_AUTO_BG_HANDOFF, MARKET_AUTO_BG_TICK, MARKET_AUTO_BG_HEARTBEAT, MARKET_AUTO_BG_REPORT].includes(message.type)) { sendResponse({ ok: false, error: "v0341_manual_period_only" }); return false; }',
      '  if (message.type === MARKET_AUTO_BG_HANDOFF) return true;',
      '  if (message.type === MARKET_AUTO_BG_TICK) return true;',
      '  if (message.type === MARKET_AUTO_BG_HEARTBEAT) return true;',
      '  if (message.type === MARKET_AUTO_BG_REPORT) return true;',
      '  return false;',
      '}',
    ].join("\n"),
    "popup.js": 'const version = "0.3.41";',
    "popup.html": '<div>0.3.41</div>',
    "recovery.mjs": 'const version = "0.3.41";',
    "shopling-market-auto-agent.mjs": [
      'if (globalThis.__commerceOsShoplingMarketAutoAgentV0330) return;',
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

test("v0.3.42 removes inherited manual-period blocker but keeps durable background handlers", () => {
  const output = buildOneClickIntentV0342(sourceFixture());
  const background = output["background-root.mjs"];
  assert.ok(!background.includes("v0342_manual_period_only"));
  assert.ok(!background.includes("manual_period_only"));
  for (const marker of [
    "message.type === MARKET_AUTO_BG_HANDOFF",
    "message.type === MARKET_AUTO_BG_TICK",
    "message.type === MARKET_AUTO_BG_HEARTBEAT",
    "message.type === MARKET_AUTO_BG_REPORT",
  ]) assert.ok(background.includes(marker), `background handler missing ${marker}`);
});

test("v0.3.42 rewrites both one-click agent guard occurrences and remains idempotent on reinjection", () => {
  const output = buildOneClickIntentV0342(sourceFixture());
  const agent = output["shopling-market-auto-agent.mjs"];
  assert.equal((agent.match(/__commerceOsShoplingMarketAutoAgentV0342/g) || []).length, 2);
  assert.ok(!agent.includes("__commerceOsShoplingMarketAutoAgentV0330"));
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
