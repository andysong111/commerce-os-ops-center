import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v0330/download/route.ts", import.meta.url);
const autoRoute = new URL("../src/app/api/shopling-market-auto-orchestration/route.ts", import.meta.url);
const server = new URL("../src/lib/shoplingMarketAutoOrchestrationServer.ts", import.meta.url);
const oneClick = new URL("../src/app/seo-bulk-cloud/SeoBulkShoplingOneClickControl.tsx", import.meta.url);
const scripts = new URL("../src/lib/shoplingMarketAutoExtensionV0330.ts", import.meta.url);
const migration = new URL("../supabase/migrations/202609020002_shopling_market_auto_orchestrations.sql", import.meta.url);

test("v0.3.30 package includes Commerce OS handoff and Shopling auto-agent", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.match(source, /const VERSION = "0\.3\.30"/);
  assert.match(source, /commerce-os-market-auto-bridge\.mjs/);
  assert.match(source, /shopling-market-auto-agent\.mjs/);
  assert.match(source, /MARKET_AUTO_BG_HANDOFF/);
  assert.match(source, /agent_poll/);
});

test("one-click control probes v0.3.30 before creating durable orchestration", async () => {
  const source = await readFile(oneClick, "utf8");
  assert.match(source, /샵플링 일괄 대량등록 및 마켓전송/);
  assert.match(source, /기존 등록상품 마켓전송만 재개/);
  assert.match(source, /create_market_only/);
  assert.match(source, /createHandoffToken/);
  assert.match(source, /probeExtension\(\)/);
  assert.match(source, /handoffToExtension/);
  assert.match(source, /shopling-market-auto-orchestration/);
});

test("agent route keeps browser actions token scoped", async () => {
  const source = await readFile(autoRoute, "utf8");
  assert.match(source, /MARKET_AUTO_AGENT_BRIDGE/);
  assert.match(source, /agent_poll/);
  assert.match(source, /agent_heartbeat/);
  assert.match(source, /agent_report/);
  assert.match(source, /validMarketAutoToken/);
});

test("server verifies market ledger and chunks more than twenty products", async () => {
  const source = await readFile(server, "utf8");
  assert.match(source, /shopling_market_auto_orchestrations/);
  assert.match(source, /shopling_market_pipeline_ledger/);
  assert.match(source, /computeMarketSummary/);
  assert.match(source, /const CHUNK_SIZE = 20/);
  assert.match(source, /remainingMarketJobIds/);
  assert.match(source, /state: "market_ready"/);
  assert.match(source, /createMarketOnlyOrchestration/);
  assert.match(source, /verifiedMarketOnlyUploadJob/);
  assert.match(source, /marketOnlyLedgerSafety/);
  assert.match(source, /insertOrRecoverOrchestration/);
});

test("browser scripts persist handoff and resume through durable selection intent", async () => {
  const source = await readFile(scripts, "utf8");
  assert.match(source, /commerceOsShoplingMarketAutoActiveV0330/);
  assert.match(source, /commerceOsShoplingMarketSelectionIntentV0330/);
  assert.match(source, /BG_HEARTBEAT/);
  assert.match(source, /BG_REPORT/);
  assert.match(source, /slice\(0, 20\)/);
});

test("auto orchestration table is RLS locked from browser roles", async () => {
  const source = await readFile(migration, "utf8");
  assert.match(source, /enable row level security/i);
  assert.match(source, /revoke all on table public\.shopling_market_auto_orchestrations from anon, authenticated/i);
  assert.match(source, /market_running/);
  assert.match(source, /completed_with_exceptions/);
});
