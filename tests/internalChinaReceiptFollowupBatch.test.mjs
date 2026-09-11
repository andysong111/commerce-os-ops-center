import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { loadPurchaseCycleModule as load, barcode, receiptCost, receiptOperation, costReadback } from "./helpers/purchaseCycleHarness.mjs";

const core = load("src/lib/internalChinaReceiptFollowupCore.ts");
const repair = load("src/lib/internalChinaReceiptFollowupRepair.ts", { "./internalChinaReceiptFollowupCore": core });

function monthlyHarness(count, { missingAt = -1, failureAt = -1, pageErrorAt = -1, truncated = false, invalidId = false } = {}) {
  const costs = Array.from({ length: count }, (_, index) => {
    const receiptId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    return { ...receiptCost, receiptId, id: `china-receipt:${receiptId}:${barcode}` };
  });
  const rows = costs.map((cost) => {
    const row = receiptOperation(cost);
    row.input_snapshot.payload.receiptId = cost.receiptId;
    row.result_snapshot.receiptId = cost.receiptId;
    return row;
  });
  if (invalidId) rows[0].result_snapshot.receiptId = "invalid";
  const before = JSON.stringify(rows);
  const calls = [], ranges = [];
  let active = 0, maximumActive = 0, cacheReads = 0;
  const forbidden = () => { throw new Error("MONTHLY_READ_MUST_NOT_WRITE"); };
  const service = load("src/lib/internalChinaReceiptFollowup.ts", {
    "@/lib/chinaOrderLedger": { CHINA_ORDER_EVENT_OPERATION_TYPE: "CHINA_ORDER_COMMITMENT_EVENT" },
    "@/lib/priceAdjustmentReceiptCache": {
      readPriceAdjustmentReceiptCache: async () => { cacheReads++; return { receiptsByBarcode: { [barcode]: costs } }; },
      mergePriceAdjustmentReceiptCachePage: forbidden,
    },
    "@/lib/productMasterCanonicalSync": { buildCanonicalProductMasterSnapshot: forbidden },
    "@/lib/opsLoginBypass": { temporaryOpsIdentity: forbidden },
    "@/lib/productLaunchTrackerServer": { getProductLaunchAdminConfig: forbidden, readProductLaunchState: forbidden },
    "@/lib/internalChinaForwarderStoredClose": { loadStoredInternalChinaForwarderClose: forbidden },
    "@/lib/internalChinaReceiptFollowupCore": core,
    "@/lib/internalChinaReceiptFollowupRepair": repair,
    "@/lib/supabase/admin": { createSupabaseAdminClient: async () => ({
      from: (table) => {
        assert.equal(table, "commerce_operation_runs");
        let start = 0, end = 0;
        const filters = [];
        const query = {
          select: () => query,
          eq: (...args) => { filters.push(args); return query; },
          order: (column) => { assert.equal(column, "source_event_id"); return query; },
          range: (first, last) => { start = first; end = last; ranges.push([first, last]); return query; },
          then: (resolve, reject) => {
            assert.deepEqual(filters, [["operation_type", "CHINA_ORDER_COMMITMENT_EVENT"], ["source", "ops-center-internal-china-receipt"], ["status", "SUCCEEDED"], ["result_snapshot->>cycleMonth", "2026-09"]]);
            assert.equal(end - start + 1, 1000);
            return Promise.resolve({ data: truncated ? Array.from({ length: 1000 }, () => rows[0]) : rows.slice(start, end + 1), error: start === pageErrorAt ? { message: "fixture-page-error" } : null }).then(resolve, reject);
          },
          insert: forbidden, update: forbidden, upsert: forbidden, delete: forbidden,
        };
        return query;
      },
    }) },
  }, {
    process: { env: { PRODUCT_MASTER_INTEGRATION_SECRET: "fixture-only", PRODUCT_MASTER_BASE_URL: "https://pm.example" } },
    fetch: async (url, options = {}) => {
      const target = new URL(url);
      assert.equal(target.origin, "https://pm.example");
      assert.equal(target.pathname, "/api/integrations/internal-receipt-readback");
      assert.equal(options.method || "GET", "GET");
      assert.equal(options.cache, "no-store");
      assert.ok(options.signal);
      const id = target.searchParams.get("receiptId");
      const index = costs.findIndex((cost) => cost.receiptId === id);
      assert.notEqual(index, -1);
      calls.push(id); active++; maximumActive = Math.max(maximumActive, active);
      await nextTurn();
      active--;
      if (index === failureAt) return Response.json({ ok: false }, { status: 503 });
      return Response.json({ ...costReadback(index === missingAt ? [] : [costs[index]]), receiptId: id });
    },
  });
  return { service, costs, calls, ranges, maximumActive: () => maximumActive, cacheReads: () => cacheReads, assertUnchanged: () => assert.equal(JSON.stringify(rows), before) };
}

for (const count of [0, 30, 31, 91, 1000, 1001]) {
  test(`monthly readback covers all ${count} receipts without a 30-confirmation ceiling or concurrent fan-out`, async () => {
    const h = monthlyHarness(count);
    const result = await h.service.loadInternalChinaReceiptFollowups("2026-09");
    assert.equal(result.length, count);
    assert.deepEqual(Array.from(result, (row) => row.receiptId), h.costs.map((cost) => cost.receiptId));
    assert.equal(result.every((row) => row.state === "VERIFIED" && row.canRetry === false && row.receivedQuantity === 7 && /^sha256:/.test(row.fingerprint)), true);
    assert.equal(h.calls.length, count);
    assert.equal(new Set(h.calls).size, count);
    assert.equal(h.maximumActive(), Math.min(count, 3));
    assert.equal(h.cacheReads(), count ? 1 : 0);
    assert.deepEqual(h.ranges, count < 1000 ? [[0, 999]] : [[0, 999], [1000, 1999]]);
    h.assertUnchanged();
  });
}

test("a missing receipt and a failed read after receipt 30 stay pending without hiding the remaining results", async () => {
  const h = monthlyHarness(34, { missingAt: 30, failureAt: 31 });
  const result = await h.service.loadInternalChinaReceiptFollowups("2026-09");
  assert.equal(result.length, 34);
  assert.equal(result.filter((row) => row.state === "VERIFIED").length, 32);
  assert.equal(result[30].state, "PENDING"); assert.equal(result[30].canRetry, true);
  assert.equal(result[30].fingerprint, null);
  assert.equal(result[31].state, "PENDING"); assert.equal(result[31].canRetry, false);
  assert.equal(result[31].errorCode, "RECEIPT_FOLLOWUP_READBACK_HTTP_503");
  assert.equal(result[33].state, "VERIFIED");
  assert.equal(h.maximumActive(), 3);
  h.assertUnchanged();
});

test("a failed second ledger page cannot silently certify only the first 1000 rows", async () => {
  const h = monthlyHarness(1001, { pageErrorAt: 1000 });
  await assert.rejects(h.service.loadInternalChinaReceiptFollowups("2026-09"), /RECEIPT_FOLLOWUP_LEDGER_READ_FAILED/);
  assert.equal(h.calls.length, 0); assert.equal(h.cacheReads(), 0);
  h.assertUnchanged();
});

test("ledger truncation and malformed receipt IDs remain fail-closed before downstream reads", async () => {
  const truncated = monthlyHarness(1, { truncated: true });
  await assert.rejects(truncated.service.loadInternalChinaReceiptFollowups("2026-09"), /RECEIPT_FOLLOWUP_LEDGER_TRUNCATED/);
  assert.equal(truncated.ranges.length, 10); assert.equal(truncated.calls.length, 0);
  const invalid = monthlyHarness(31, { invalidId: true });
  await assert.rejects(invalid.service.loadInternalChinaReceiptFollowups("2026-09"), /RECEIPT_FOLLOWUP_LEDGER_ID_INVALID/);
  assert.equal(invalid.calls.length, 0);
  truncated.assertUnchanged(); invalid.assertUnchanged();
});
