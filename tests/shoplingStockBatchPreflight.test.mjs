import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { bindStockBatchPlans, missingStockPlanReceipts, orderStockBatchJobs, preflightShoplingStockJobs, retainQueueCommandPlans, stockPlanReceiptSummary, verifyStockPlanTerminal } from "../src/lib/shoplingStockBatchPreflight.ts";
import { supportsStockParentFinalization } from "../src/lib/shoplingStockLaunchPlan.ts";

const jobs = ["BCD8-1", "BCD8-2", "BCC5-1"].map((barcode, i) => ({
  jobId: String(i), barcode, productKind: "OPTION", desiredStatus: i < 2 ? "ON_SALE" : "SOLD_OUT", goodsKeys: [],
}));
const items = jobs.map((job, i) => ({ ...job, dependencies: i === 1 ? ["BCD8-1"] : [], stockBatchPlan: "signed:" + job.jobId }));

test("one read-only preflight covers both BCD8 siblings and independent products before dispatch", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/inventory-stock-control/shopling-option-status");
    assert.deepEqual(JSON.parse(options.body), { mode: "PREFLIGHT_BATCH", items: jobs.map(({barcode, productKind, desiredStatus, goodsKeys}) => ({barcode, productKind, desiredStatus, goodsKeys})) });
    return Response.json({ ok: true, result: { items, products: [{ goodsKey: "123" }] } });
  });
  const result = await preflightShoplingStockJobs(jobs);
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(result.jobs.map((job) => job.stockBatchPlan), items.map((item) => item.stockBatchPlan));
  assert.deepEqual(result.products, [{ goodsKey: "123" }]);
});

test("mismatched input order, absent sibling, invalid plan, duplicate B-code and forward dependency fail before execution", () => {
  for (const invalid of [items.slice(1), [...items].reverse(), [{...items[0], stockBatchPlan: ""}, ...items.slice(1)],
    [{...items[0], dependencies:["BCD8-2"]}, ...items.slice(1)], [{...items[0], desiredStatus: "SOLD_OUT"}, ...items.slice(1)]]) {
    assert.throws(() => bindStockBatchPlans(jobs, {items: invalid}));
  }
  assert.throws(() => bindStockBatchPlans([jobs[0],jobs[0]], {items:[items[0],items[0]]}));
});

test("no parent finalization after a sibling's option API mutation without the complete A21 receipt", () => {
  const planned = bindStockBatchPlans(jobs, { items });
  const accepted = new Set();
  const result = verifyStockPlanTerminal({outcome: "SUCCEEDED", evidence: {responsibilityReceiptAccepted: true}});
  assert.equal(result.outcome, "UNCERTAIN");
  assert.equal(result.evidence.retrySafe, false);
  assert.deepEqual(missingStockPlanReceipts(planned[1], accepted), ["BCD8-1"]);
  assert.deepEqual(missingStockPlanReceipts(planned[2], accepted), []);
  const complete = verifyStockPlanTerminal({outcome: "SUCCEEDED", evidence:{stockPlanComplete:true, marketFailureCount:5}});
  assert.equal(complete.outcome, "SUCCEEDED");
  accepted.add(planned[0].barcode);
  assert.deepEqual(missingStockPlanReceipts(planned[1], accepted), []);
  assert.throws(() => missingStockPlanReceipts(jobs[1], accepted));
});

test("saved-command order survives queue reorder and excludes nonselected prerequisites", () => {
  const planned = bindStockBatchPlans(jobs, {items});
  assert.deepEqual(orderStockBatchJobs([planned[1], planned[0]]).map((job) => job.barcode), ["BCD8-1", "BCD8-2"]);
  assert.deepEqual(orderStockBatchJobs([planned[1]]), [planned[1]]);
  assert.throws(() => orderStockBatchJobs([{...planned[0], stockBatchDependencies:["BCD8-2"]}, planned[1]]));
});

test("queue recovery cannot discard original signed expiry or use another command's sibling receipts", () => {
  const fresh = bindStockBatchPlans(jobs, {items});
  const saved = jobs.map((job, i) => i < 2 ? { ...job, retransmissionRequestId: "a", stockBatchPlan: "original-" + i,
    stockBatchDependencies: i === 1 ? [jobs[0].barcode] : [] } : job);
  const product = { goodsKey: "111", productSaleStatus:"C", options: jobs.slice(0, 2).map(({barcode}) => ({barcode})) };
  const mixed = [...saved];
  mixed[1] = {...saved[1], retransmissionRequestId: "b"};
  assert.throws(() => retainQueueCommandPlans(mixed, fresh, [product]), /서로 다른 전송 요청/);
  assert.throws(() => retainQueueCommandPlans([jobs[0], ...saved.slice(1)], fresh, [product]), /서로 다른 전송 요청/);
  assert.deepEqual(retainQueueCommandPlans(saved, fresh, [product]).map(job => job.stockBatchPlan), ["original-0", "original-1", fresh[2].stockBatchPlan]);
  assert.equal(retainQueueCommandPlans([saved[1]], [fresh[1]], [product])[0].stockBatchPlan, "original-1");
});

test("readback shows outstanding product send separately from accepted option send", () => {
  assert.equal(stockPlanReceiptSummary({ stockPlanComplete:false, completedStockPlanLegs:[{transmissionKind:"OPTION_SEND"}],
    remainingTransmissionGroups:[{transmissionKind:"PRODUCT_SALE_STATUS_SEND"}]}), "접수 확인 · 옵션 1회 / 접수 미확인 · 상품상태 1회");
  assert.equal(stockPlanReceiptSummary({ stockPlanComplete:true, stockStateGroupReceipts:[{transmissionKind:"OPTION_SEND"},{transmissionKind:"PRODUCT_SALE_STATUS_SEND"}]}),
    "접수 확인 · 옵션 1회 · 상품상태 1회");
  assert.equal(stockPlanReceiptSummary({}), "");
});

test("unified input saves all planned dependencies before mutations; operational recovery honors exact confirmed siblings", async () => {
  const [unified, queue, sync, ledger] = await Promise.all([
    "src/lib/unifiedInventoryBatch.ts", "src/components/china-order-manager/StockSyncOperationalQueuePanel.tsx",
    "src/app/api/inventory-stock-control/sync/route.ts", "src/lib/inventoryShoplingRetransmission.ts",
  ].map((f) => readFile(f, "utf8")));
  assert.ok(unified.indexOf("await prepareShoplingStockBatch") < unified.indexOf("await storeInventoryOperationBatch"));
  assert.match(unified, /stockBatchDependencies: job.stockBatchDependencies/);
  assert.match(queue, /selectExactShoplingStockQueueJob\(available, planned\)/);
  assert.match(queue, /stockPlan|preflightShoplingStockJobs/);
  assert.match(sync, /confirmedStockDependencies: item.confirmedStockDependencies/);
  assert.match(ledger, /object\(source.evidence\).stockPlanComplete === true/);
  assert.equal(supportsStockParentFinalization("0.6.61"), false);
  assert.equal(supportsStockParentFinalization("0.6.62"), true);
});
