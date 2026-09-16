import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { GET as downloadV0342 } from "../src/app/api/shopling-market-group-canary/v0342/download/route.ts";

test("v0.3.42 one-click agent writes the same current queue/intent keys as the A18 runner", async () => {
  const response = await downloadV0342();
  assert.equal(response.status, 200);
  const zip = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(zip["manifest.json"]));
  const agent = strFromU8(zip["shopling-market-auto-agent.mjs"]);
  const content = strFromU8(zip["content-group-canary.mjs"]);
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

test("v0.3.42 keeps the durable v0330 server handoff protocol while replacing only stale local state", async () => {
  const response = await downloadV0342();
  const zip = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const agent = strFromU8(zip["shopling-market-auto-agent.mjs"]);
  for (const marker of [
    "commerce-os-shopling-market-auto-bg-tick-v0330",
    "commerce-os-shopling-market-auto-bg-heartbeat-v0330",
    "commerce-os-shopling-market-auto-bg-report-v0330",
  ]) assert.ok(agent.includes(marker));
});

test("v0.3.42 retains v0.3.41 result readback and fail-closed submit protection", async () => {
  const response = await downloadV0342();
  const zip = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const background = strFromU8(zip["background-root.mjs"]);
  const content = strFromU8(zip["content-group-canary.mjs"]);
  assert.ok(background.includes("prod_rgst_(?:rspt|trsmt|tsrmt)"));
  assert.ok(background.includes("DIRECT_RESULT_MAX_ATTEMPTS = 240"));
  assert.ok(content.includes("submit_armed"));
  assert.ok(content.includes("selectedMallIds") || content.includes("mallIds"));
});
