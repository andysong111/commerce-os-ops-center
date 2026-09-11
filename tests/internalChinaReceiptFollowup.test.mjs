import assert from "node:assert/strict";
import test from "node:test";
import { loadPurchaseCycleModule as load, receiptId, draftId, barcode, at, receiptCost as cost, receiptOperation, costReadback } from "./helpers/purchaseCycleHarness.mjs";
const core = load("src/lib/internalChinaReceiptFollowupCore.ts");
const repair = load("src/lib/internalChinaReceiptFollowupRepair.ts", { "./internalChinaReceiptFollowupCore": core });

test("receipt follow-up uses original quantity evidence and preserves later finalized cache costs", () => {
  const bundle = core.receiptFollowupBundle(receiptId, [receiptOperation()]);
  assert.equal(core.selectReceiptFollowupCosts(bundle, [{ ...cost, unitCostKrw: 999 }]).costs[0].unitCostKrw, 999);
  assert.equal(core.selectReceiptFollowupCosts(bundle, []).costs[0].quantity, 7);
  assert.equal(core.selectReceiptFollowupCosts(bundle, []).missing.length, 1);
  const legacy = receiptOperation(); delete legacy.result_snapshot.receiptCost;
  assert.throws(() => core.selectReceiptFollowupCosts(core.receiptFollowupBundle(receiptId, [legacy]), []), /SOURCE_COST_REQUIRED/);
});
test("partial source, duplicate receipt lines and cross-scope data cannot become recovery evidence", () => {
  const partial = receiptOperation(); partial.result_snapshot.receiptLineCount = 2;
  assert.throws(() => core.receiptFollowupBundle(receiptId, [partial]), /INCOMPLETE/);
  assert.throws(() => core.receiptFollowupBundle(receiptId, [receiptOperation(), receiptOperation()]));
  const other = receiptOperation(); other.input_snapshot.sourceSystem = "unrelated";
  assert.throws(() => core.receiptFollowupBundle(receiptId, [other]), /SOURCE_CONFLICT/);
  assert.throws(() => core.receiptFollowupBundle("*", []));
});
test("HTTP success, empty rows or mismatching cost/quantity/SKU never certify persisted receipt costs", () => {
  assert.match(core.compareReceiptFollowupReadback([cost], costReadback()), /^sha256:/);
  for (const payload of [{ ok: true }, costReadback([]), { ...costReadback(), rows: [...costReadback().rows, ...costReadback().rows] }, ...[{ quantity: 8 }, { unitCostKrw: 999 }, { skuId: "" }, { receivedAt: "invalid" }].map((patch) => ({ ...costReadback(), rows: [{ ...costReadback().rows[0], ...patch }] }))]) {
    assert.throws(() => core.compareReceiptFollowupReadback([cost], payload));
  }
  assert.throws(() => repair.validateReceiptReadbackIdentity([cost], { ...costReadback(), rows: [{ ...costReadback().rows[0], barcode: "BBB9-1" }] }), /IDENTITY_CONFLICT/);
});
test("missing-only repair rejects conflicts and never sends catalog or inventory mutations", () => {
  assert.equal(repair.missingReceiptCostRows([cost], costReadback([])).length, 1);
  assert.equal(repair.missingReceiptCostRows([cost], costReadback()).length, 0);
  assert.throws(() => repair.missingReceiptCostRows([cost], costReadback([{ ...cost, unitCostKrw: 999 }])), /CONFLICT/);
  const row = { id: "receipt:fixture", externalId: cost.id, skuId: "tracker-id", quantity: 7, unitCostKrw: 430, receivedAt: at, source: "ops_center_confirmed_receipt_cache" };
  const catalog = { ok: true, products: [{ modelNo: "AAA123", skus: [{ skuId: "stable-sku", barcode, active: true }] }] };
  const result = repair.receiptCostOnlyPayload([cost], [row], catalog);
  assert.equal(result.receiptCosts[0].skuId, "stable-sku");
  assert.deepEqual(Object.keys(result).sort(), ["receiptCosts", "receiptId"]);
  catalog.products[0].skus[0].barcode = "BBB9-1";
  assert.throws(() => repair.receiptCostOnlyPayload([cost], [row], catalog), /IDENTITY_REQUIRED/);
});
function serviceHarness({ drop = false, conflict = false, sourceMissing = false, finalClosed = false } = {}) {
  const operation = receiptOperation();
  let cache = sourceMissing ? { snapshotId: "fixture", complete: true, receiptsByBarcode: {} } : { snapshotId: "fixture", complete: true, receiptsByBarcode: { [barcode]: [cost] } };
  let persisted = conflict ? costReadback([{ ...cost, unitCostKrw: 999 }]).rows : [];
  const posts = [], merges = [], queries = [];
  const query = { then: (resolve) => Promise.resolve({ data: [operation], error: null }).then(resolve) };
  for (const method of ["select", "eq", "order", "limit", "range"]) query[method] = (...args) => { queries.push([method, ...args]); return query; };
  const canonical = { id: `receipt:${encodeURIComponent(cost.id.toUpperCase())}`, externalId: cost.id, skuId: "tracker-id", quantity: 7, unitCostKrw: 430, receivedAt: at, source: "ops_center_confirmed_receipt_cache" };
  const imports = {
    "@/lib/chinaOrderLedger": { CHINA_ORDER_EVENT_OPERATION_TYPE: "CHINA_ORDER_COMMITMENT_EVENT" },
    "@/lib/priceAdjustmentReceiptCache": {
      readPriceAdjustmentReceiptCache: async () => cache,
      mergePriceAdjustmentReceiptCachePage: async (input) => { merges.push(input); cache = { ...cache, receiptsByBarcode: { [barcode]: input.receipts } }; },
    },
    "@/lib/productMasterCanonicalSync": { buildCanonicalProductMasterSnapshot: () => ({ skipped: { receiptWithoutSku: 0 }, payload: { receiptCosts: [canonical] } }) },
    "@/lib/opsLoginBypass": { temporaryOpsIdentity: () => ({ userId: "fixture-operator" }) },
    "@/lib/productLaunchTrackerServer": { getProductLaunchAdminConfig: () => ({ ok: true, value: {} }), readProductLaunchState: async () => ({ state_payload: { items: [] } }) },
    "@/lib/internalChinaForwarderStoredClose": { loadStoredInternalChinaForwarderClose: async () => finalClosed ? { actualCostKrw: 999 } : null },
    "@/lib/supabase/admin": { createSupabaseAdminClient: async () => ({ from: (table) => { assert.equal(table, "commerce_operation_runs"); return query; } }) },
    "@/lib/internalChinaReceiptFollowupCore": core,
    "@/lib/internalChinaReceiptFollowupRepair": repair,
  };
  const service = load("src/lib/internalChinaReceiptFollowup.ts", imports, {
    process: { env: { PRODUCT_MASTER_INTEGRATION_SECRET: "fixture-only", PRODUCT_MASTER_BASE_URL: "https://pm.example" } },
    fetch: async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (options.method === "POST") {
        assert.equal(path, "/api/integrations/internal-receipt-repair");
        const body = JSON.parse(options.body); posts.push(body);
        assert.deepEqual(Object.keys(body).sort(), ["receiptCosts", "receiptId"]);
        if (!drop) persisted = body.receiptCosts.map((row) => ({ externalId: row.externalId, barcode, skuId: row.skuId, quantity: row.quantity, unitCostKrw: row.unitCostKrw, receivedAt: row.receivedAt }));
        return Response.json({ ok: true });
      }
      if (path === "/api/integrations/internal-receipt-readback") return Response.json({ ...costReadback([]), rows: persisted });
      assert.equal(path, "/api/integrations/inventory-catalog");
      return Response.json({ ok: true, products: [{ modelNo: "AAA123", skus: [{ skuId: "stable-sku", barcode, active: true }] }] });
    },
  });
  return { service, posts, merges, queries, persisted: () => persisted, operation };
}
test("actual follow-up service retries only missing persisted costs; repeated call cannot add quantity", async () => {
  const h = serviceHarness();
  assert.equal((await h.service.retryInternalChinaReceiptFollowup(receiptId)).state, "VERIFIED");
  assert.equal((await h.service.retryInternalChinaReceiptFollowup(receiptId)).state, "VERIFIED");
  assert.equal(h.posts.length, 1); assert.equal(h.persisted()[0].quantity, 7);
  assert.equal(h.operation.result_snapshot.receivedNow, 7);
  assert.equal(h.queries.some(([method]) => ["upsert", "insert", "update", "delete"].includes(method)), false);
});
test("actual follow-up rejects delivery without persistence and preserves existing final-cost conflict", async () => {
  const dropped = serviceHarness({ drop: true });
  await assert.rejects(dropped.service.retryInternalChinaReceiptFollowup(receiptId), /READBACK_MISSING/);
  const conflict = serviceHarness({ conflict: true });
  await assert.rejects(conflict.service.retryInternalChinaReceiptFollowup(receiptId), /EXISTING_COST_CONFLICT/);
  assert.equal(conflict.posts.length, 0); assert.equal(conflict.persisted()[0].unitCostKrw, 999);
});
test("captured purchase cost can repair missing cache only before final cost closure", async () => {
  const h = serviceHarness({ sourceMissing: true });
  assert.equal((await h.service.retryInternalChinaReceiptFollowup(receiptId)).state, "VERIFIED");
  assert.equal(h.merges.length, 1);
  const closed = serviceHarness({ sourceMissing: true, finalClosed: true });
  await assert.rejects(closed.service.retryInternalChinaReceiptFollowup(receiptId), /FINAL_COST_SOURCE_REQUIRED/);
  assert.equal(closed.posts.length, 0); assert.equal(closed.merges.length, 0);
});
test("actual follow-up API authenticates first, rejects quantity input, and only accepts stored receiptId", async () => {
  let calls = 0;
  const route = load("src/app/api/china-order-manager/receipts/followup/route.ts", {
    "@/lib/opsLoginBypass": { isSameOriginOpsRequest: (request) => request.headers.get("origin") === "https://ops.example" },
    "@/lib/internalChinaReceiptFollowupCore": core,
    "@/lib/internalChinaReceiptFollowup": { retryInternalChinaReceiptFollowup: async (id) => { assert.equal(id, receiptId); calls++; return { state: "VERIFIED" }; } },
  });
  const request = (body, auth = true) => new Request("https://ops.example/followup", { method: "POST", headers: auth ? { origin: "https://ops.example" } : {}, body: JSON.stringify(body) });
  assert.equal((await route.POST(request({ receiptId }, false))).status, 401);
  for (const value of [null, [], { receiptId, quantity: 7 }, { receiptId: "bad" }]) assert.equal((await route.POST(request(value))).status, 400);
  assert.equal(calls, 0);
  assert.equal((await route.POST(request({ receiptId }))).status, 200);
  assert.equal(calls, 1); assert.equal(route.GET, undefined);
});
test("actual receipt engine captures original cost durably before downstream failure and preserves open-quantity guard", async () => {
  const writes = []; let followups = 0;
  const engine = load("src/lib/internalChinaReceipt.ts", {
    "@/lib/chinaOrderLedger": { CHINA_ORDER_EVENT_OPERATION_TYPE: "CHINA_ORDER_COMMITMENT_EVENT", normalizeChinaOrderCommitmentEvent: (event) => event, loadChinaOrderLedger: async () => ({ error: null, commitments: [{ sourceSystem: "fast-purchase-mvp", sourceRunId: draftId, sourceLineId: "line-1", barcode, reservedAt: at, updatedAt: at, openQuantity: 10, committedQuantity: 10, cancelledQuantity: 0, receivedQuantity: 0 }] }) },
    "@/lib/internalChinaDraftQuantityOverride": { loadInternalChinaDraftWithQuantityOverrides: async (value) => value },
    "@/lib/internalChinaPurchaseDraft": { loadInternalChinaPurchaseDraft: async () => ({ exchangeRateKrwPerCny: 230, lines: [{ barcode, modelNo: "AAA123", saleOption: "단품", quantity: 10, freightGroupId: "group-1", unitPriceCny: 2, domesticChinaFreightCny: 10 }] }) },
    "@/lib/monthlyPurchasePolicy": { koreanMonthLabel: (value) => value, seoulCalendarMonth: () => "2026-09" },
    "@/lib/internalChinaReceiptFollowup": { retryInternalChinaReceiptFollowup: async () => { assert.equal(writes.length, 1); assert.equal(writes[0][0].result_snapshot.receiptCost.unitCostKrw, 690); followups++; throw new Error("RECEIPT_FOLLOWUP_READBACK_MISSING"); } },
    "@/lib/supabase/admin": { createSupabaseAdminHeaders: () => ({}) },
  }, { process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://db.example", SUPABASE_SECRET_KEY: "fixture-only" } }, fetch: async (url, options) => { assert.match(url, /commerce_operation_runs/); writes.push(JSON.parse(options.body)); return Response.json([{ source_event_id: "stored" }]); } });
  const result = await engine.recordInternalChinaReceipt({ draftId, cycleMonth: "2026-09", lines: [{ barcode, quantity: 7 }] });
  assert.equal(result.receivedNow, 7); assert.equal(result.productMasterSynced, false);
  assert.equal(result.productMasterError, "RECEIPT_FOLLOWUP_READBACK_MISSING");
  assert.equal(writes[0][0].result_snapshot.receiptLineCount, 1);
  await assert.rejects(engine.recordInternalChinaReceipt({ draftId, cycleMonth: "2026-09", lines: [{ barcode, quantity: 11 }] }), /QUANTITY_EXCEEDED/);
  assert.equal(writes.length, 1); assert.equal(followups, 1);
});
