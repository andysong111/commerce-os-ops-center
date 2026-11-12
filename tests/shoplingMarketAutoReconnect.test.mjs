import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { decideMarketAutoReconnect } from "../src/lib/shoplingMarketAutoReconnectPolicy.ts";

const ROOT = new URL("../", import.meta.url);

test("waiting upload orchestration can receive a new browser handoff token", () => {
  assert.deepEqual(
    decideMarketAutoReconnect({ state: "waiting_upload" }),
    {
      reconnectAllowed: true,
      terminal: false,
      activeAgent: false,
      nextState: "waiting_upload",
    },
  );
});

test("an active leased browser agent is never displaced", () => {
  const nowMs = Date.parse("2026-11-13T00:00:00.000Z");
  assert.deepEqual(
    decideMarketAutoReconnect({
      state: "market_running",
      agentId: "shopling-market-agent-1234",
      leaseUntil: "2026-11-13T00:03:00.000Z",
      nowMs,
    }),
    {
      reconnectAllowed: false,
      terminal: false,
      activeAgent: true,
      nextState: "market_running",
    },
  );
});

test("an expired browser lease is recovered from market_ready without resubmitting Shopling", () => {
  const nowMs = Date.parse("2026-11-13T00:04:00.000Z");
  assert.deepEqual(
    decideMarketAutoReconnect({
      state: "market_running",
      agentId: "shopling-market-agent-1234",
      leaseUntil: "2026-11-13T00:03:00.000Z",
      nowMs,
    }),
    {
      reconnectAllowed: true,
      terminal: false,
      activeAgent: false,
      nextState: "market_ready",
    },
  );
});

test("terminal orchestration is not handed off again", () => {
  assert.equal(
    decideMarketAutoReconnect({ state: "completed" }).terminal,
    true,
  );
});

test("one-click UI retains and periodically replays the same durable handoff", async () => {
  const source = await readFile(
    new URL("src/app/seo-bulk-cloud/SeoBulkShoplingOneClickControl.tsx", ROOT),
    "utf8",
  );
  assert.match(source, /HANDOFF_RECOVERY_MS/);
  assert.match(source, /action:\s*"reconnect"/);
  assert.match(source, /setInterval\([\s\S]*?retryPendingHandoff/);
  assert.match(source, /handedOffAt:\s*Date\.now\(\)/);
  assert.match(source, /const dispatchToday = candidate\.dispatchToday/);
  assert.match(source, /knownBridgeAvailability \?\? await probeExtension\(\)/);
  assert.match(source, /버튼을 다시 누르지 않아도 자동 재개됩니다/);
  assert.match(
    source,
    /if \(await handoffToExtension\(orchestrationId, token\)\) \{[\s\S]*?setItem\([\s\S]*?handedOffAt:[\s\S]*?\n\s*\}/,
  );
});

test("authenticated reconnect route is wired to the server recovery function", async () => {
  const route = await readFile(
    new URL("src/app/api/shopling-market-auto-orchestration/route.ts", ROOT),
    "utf8",
  );
  const server = await readFile(
    new URL("src/lib/shoplingMarketAutoOrchestrationServer.ts", ROOT),
    "utf8",
  );
  assert.match(route, /reconnectMarketAutoOrchestration/);
  assert.match(route, /body\.orchestrationId/);
  assert.match(server, /\.eq\("owner_id", context\.identity\.userId\)/);
  assert.match(server, /\.eq\("state", text\(row\.state\)\)/);
  assert.match(server, /updateQuery\.is\("lease_until", null\)/);
  assert.match(server, /updateQuery\.eq\("lease_until", previousLeaseUntil\)/);
  assert.match(server, /token_hash:\s*hashToken\(token\)/);
  assert.match(server, /patch\.agent_id = null/);
  assert.match(server, /patch\.lease_until = null/);
});
