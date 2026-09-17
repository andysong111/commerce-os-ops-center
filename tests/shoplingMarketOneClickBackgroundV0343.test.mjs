import assert from "node:assert/strict";
import test from "node:test";
import { buildOneClickBackgroundV0343 } from "../src/lib/shoplingMarketOneClickBackgroundV0343.ts";

function fixture() {
  return {
    "manifest.json": JSON.stringify({ version: "0.3.42", action: { default_title: "v0.3.42" } }),
    "content-group-canary.mjs": [
      'const QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0342";',
      'const INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0342";',
    ].join("\n"),
    "background-root.mjs": [
      'const MARKET_AUTO_BG_HANDOFF = "commerce-os-shopling-market-auto-bg-handoff-v0330";',
      'const MARKET_AUTO_BG_TICK = "commerce-os-shopling-market-auto-bg-tick-v0330";',
      'const MARKET_AUTO_BG_HEARTBEAT = "commerce-os-shopling-market-auto-bg-heartbeat-v0330";',
      'const MARKET_AUTO_BG_REPORT = "commerce-os-shopling-market-auto-bg-report-v0330";',
      'chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {',
      '  if ([MARKET_AUTO_BG_HANDOFF, MARKET_AUTO_BG_TICK, MARKET_AUTO_BG_HEARTBEAT, MARKET_AUTO_BG_REPORT].includes(message.type)) { sendResponse({ ok: false, error: "v0342_manual_period_only" }); return false; }',
      '  return false;',
      '});',
    ].join("\n") + "\n",
    "popup.js": 'const VERSION = "0.3.42";',
    "popup.html": '<div>0.3.42</div>',
    "recovery.mjs": 'const VERSION = "0.3.42";',
    "shopling-market-auto-agent.mjs": [
      'if (globalThis.__commerceOsShoplingMarketAutoAgentV0342) return;',
      'globalThis.__commerceOsShoplingMarketAutoAgentV0342 = true;',
      'const BG_HANDOFF = "commerce-os-shopling-market-auto-bg-handoff-v0330";',
      'const BG_TICK = "commerce-os-shopling-market-auto-bg-tick-v0330";',
      'const BG_HEARTBEAT = "commerce-os-shopling-market-auto-bg-heartbeat-v0330";',
      'const BG_REPORT = "commerce-os-shopling-market-auto-bg-report-v0330";',
      'const QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0342";',
      'const INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0342";',
      'const ACTIVE_KEY = "commerceOsShoplingMarketAutoActiveV0342";',
      'const version = "0.3.42";',
    ].join("\n"),
  };
}

test("publishes the hotfix as a higher extension version", () => {
  const out = buildOneClickBackgroundV0343(fixture());
  const manifest = JSON.parse(out["manifest.json"]);
  assert.equal(manifest.version, "0.3.43");
  assert.match(manifest.action.default_title, /v0\.3\.43/);
});

test("removes the inherited manual-period-only blocker", () => {
  const out = buildOneClickBackgroundV0343(fixture());
  assert.doesNotMatch(out["background-root.mjs"], /manual_period_only/);
  assert.match(out["background-root.mjs"], /commerce-os-shopling-market-auto-bg-handoff-v0330/);
});

test("aligns current local queue intent active keys while preserving stable wire protocol", () => {
  const out = buildOneClickBackgroundV0343(fixture());
  const agent = out["shopling-market-auto-agent.mjs"];
  const content = out["content-group-canary.mjs"];
  for (const marker of [
    "commerceOsShoplingMarketSelectionQueueV0343",
    "commerceOsShoplingMarketSelectionIntentV0343",
  ]) {
    assert.match(agent, new RegExp(marker));
    assert.match(content, new RegExp(marker));
  }
  assert.match(agent, /commerceOsShoplingMarketAutoActiveV0343/);
  assert.match(agent, /__commerceOsShoplingMarketAutoAgentV0343/);
  for (const marker of ["handoff", "tick", "heartbeat", "report"]) {
    assert.match(agent + out["background-root.mjs"], new RegExp(`commerce-os-shopling-market-auto-bg-${marker}-v0330`));
  }
});
