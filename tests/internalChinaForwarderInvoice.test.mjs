import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPurchaseCycleModule as load } from "./helpers/purchaseCycleHarness.mjs";

test("forwarder invoice survives reload, supports corrections and isolates receipts and other cycles", async () => {
  const rows = new Map();
  const scope = { draftId: "draft-a", cycleMonth: "2026-11", evidenceHash: "barcode-v1" };
  const fetch = async (input, init) => {
    const url = new URL(input);
    assert.equal(url.pathname, "/rest/v1/commerce_operation_runs");
    const filter = key => url.searchParams.get(key)?.slice(3);
    const row = rows.get(filter("source_event_id"));
    if (init.method === "POST") {
      const value = JSON.parse(init.body);
      assert.equal(value.operation_type, "INTERNAL_CHINA_FORWARDER_INVOICE");
      assert.match(init.headers.Prefer, /ignore-duplicates/);
      if (!rows.has(value.source_event_id)) rows.set(value.source_event_id, value);
    } else {
      assert.equal(filter("operation_type"), "INTERNAL_CHINA_FORWARDER_INVOICE");
      if (init.method === "PATCH" && row?.result_snapshot.revision === filter("result_snapshot->>revision")) {
        Object.assign(row, JSON.parse(init.body));
      }
    }
    return Response.json(row ? [row] : []);
  };
  const admin = load("src/lib/supabase/admin.ts", {}, { fetch, process: { env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid", SUPABASE_SECRET_KEY: "fixture",
  } } });
  const { loadForwarderInvoice, recordForwarderInvoice } = load("src/lib/internalChinaForwarderInvoice.ts", {
    "./supabase/admin.ts": admin,
  });
  for (const value of [0, -1, 2.5, "30", 1_000_000_001]) {
    await assert.rejects(recordForwarderInvoice(scope, value, null), /INVALID/);
  }
  assert.equal(rows.size, 0);
  const invoice = await recordForwarderInvoice(scope, 1, null);
  assert.deepEqual(await loadForwarderInvoice(scope), invoice);
  assert.deepEqual(await recordForwarderInvoice(scope, 1, null), invoice);
  const edits = await Promise.allSettled([
    recordForwarderInvoice(scope, 1_000_000_000, invoice.revision),
    recordForwarderInvoice(scope, 2, invoice.revision),
  ]);
  assert.equal(edits.filter(edit => edit.status === "fulfilled").length, 1);
  assert.equal(edits.find(edit => edit.status === "rejected").reason.message, "INVOICE_CONFLICT");
  await assert.rejects(recordForwarderInvoice(scope, 3, invoice.revision), /CONFLICT/);
  assert.equal(await loadForwarderInvoice({ ...scope, draftId: "draft-b" }), null);
  assert.equal(await loadForwarderInvoice({ ...scope, evidenceHash: "barcode-v2" }), null);
  await assert.rejects(loadForwarderInvoice({ ...scope, cycleMonth: "2027-01" }), /READ_FAILED/);
  assert.equal(rows.size, 1);
});

test("only the selected open barcode cycle can save an invoice, independent of payment status", async () => {
  const draftId = "fast-purchase-draft:" + "a".repeat(20);
  const scope = { draftId, cycleMonth: "2026-11", evidenceHash: "v1" };
  let closed = null;
  let allowed = true;
  const writes = [];
  const api = load("src/app/api/china-order-manager/forwarder-invoice/route.ts", {
    "@/lib/internalChinaFreightBarcodeCompletion": { loadInternalChinaFreightBarcodeCompletion: async () => scope },
    "@/lib/internalChinaForwarderStoredClose": { loadStoredInternalChinaForwarderClose: async () => closed },
    "@/lib/internalChinaForwarderInvoice": {
      validInvoiceAmount: amount => Number.isInteger(amount) && amount > 0,
      recordForwarderInvoice: async (target, amountKrw) => { writes.push([target, amountKrw]); return { amountKrw, revision: "r1" }; },
    },
    "@/lib/productLaunchTrackerServer": { resolveProductLaunchIdentity: async () => allowed
      ? { ok: true } : { ok: false, body: { ok: false }, status: 403 } },
  });
  const save = overrides => api.POST(new Request("https://ops.example/api/china-order-manager/forwarder-invoice", {
    method: "POST", body: JSON.stringify({ ...scope, previousRevision: null, amountKrw: 12000, ...overrides }),
  }));
  assert.equal((await save({ cycleMonth: "2026-12" })).status, 409);
  assert.equal((await save({ evidenceHash: "old" })).status, 409);
  assert.equal((await save({ amountKrw: 0 })).status, 400);
  closed = { actualCostKrw: 100 };
  assert.equal((await save({})).status, 409);
  closed = null;
  allowed = false;
  assert.equal((await save({})).status, 403);
  assert.equal(writes.length, 0);
  allowed = true;
  assert.equal((await save({})).status, 200);
  assert.deepEqual(writes, [[scope, 12000]]);
});
