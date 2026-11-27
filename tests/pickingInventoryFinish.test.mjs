import assert from "node:assert/strict";
import test from "node:test";
import { pickingObservations } from "../src/lib/pickingInventoryInput.ts";
import * as direct from "../src/lib/shoplingDirectCommand.ts";
import { wakePickingDispatch } from "../local-agent/mobile-work-center/picking-dispatch.mjs";
import { loadModule } from "./monthly-price-module.mjs";

const items = [
  { barcode: "BAD5-2", picked: false, modelNumbers: ["aaa167"] },
  { barcode: "BAF5-1", picked: true },
  { barcode: "BAG4-2", picked: true },
];
const observations = [
  { barcode: "BAD5-2", soldOut: true, quantity: null },
  { barcode: "BAF5-1", soldOut: false, quantity: 0 },
];

test("a discovered shortage, counted zero and an untouched picked SKU stay distinct", () => {
  assert.deepEqual(pickingObservations(observations, items), observations);
  for (const malformed of [
    [],
    [...observations, observations[0]],
    [{ ...observations[0], barcode: "BBB9-9" }],
    [{ ...observations[0], quantity: 0 }],
    [observations[0], { ...observations[1], quantity: "" }],
    [observations[0], { ...observations[1], quantity: 1.5 }],
    [observations[0], { ...observations[1], quantity: -1 }],
    [observations[0], { ...observations[1], soldOut: true, quantity: null }],
  ])
    assert.throws(() => pickingObservations(malformed, items));
});

function fixture({ replaced = false, receiptFailure = false } = {}) {
  let ticket = null;
  const commits = [];
  const db = {
    from() {
      const query = {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return { data: ticket };
        },
      };
      return query;
    },
    async rpc(name, params) {
      assert.equal(name, "finish_picking_inventory");
      commits.push(params);
      ticket = {
        snapshot_id: "list",
        dispatch_state: "queued",
        selections: params.p_selections,
        finished_at: "now",
      };
      return receiptFailure && commits.length === 1
        ? { error: { message: "timeout" } }
        : { data: "saved" };
    },
  };
  const api = loadModule("../src/lib/pickingInventoryFinish.ts", {
    "@/lib/supabase/admin": { createSupabaseAdminClient: async () => db },
    "@/lib/pickingShare": {
      readPickingShare: async () => ({
        ok: true,
        value: {
          snapshotId: replaced ? "new" : "list",
          updatedAt: "version",
          items,
        },
      }),
      tokenHash: () => "hash",
    },
    "@/lib/pickingInventoryInput": { pickingObservations },
    "@/lib/shoplingDirectCommand": direct,
    "@/lib/unifiedInventoryBatch": {
      async processUnifiedInventoryBatch(body, write, models) {
        assert.equal(body.stockPlanVersion, 1);
        assert.deepEqual(Array.from(models.get("BAD5-2")), ["AAA167"]);
        await write(
          body.stocktakeItems.map((i) => ({ sourceEventId: i.barcode })),
          body.stockoutBarcodes.map((barcode) => ({ barcode })),
        );
        return new Response("{}");
      },
    },
  });
  return {
    api,
    commits,
    finish: (entries = observations) =>
      api.finishPickingInventory("token", {
        snapshotId: "list",
        observations: entries,
      }),
  };
}
test("commit is snapshot scoped, returns the stored receipt, and retries an uncertain acknowledgement without another stock write", async () => {
  const f = fixture({ receiptFailure: true });
  await assert.rejects(f.finish());
  const retry = await f.finish();
  assert.equal(retry.status, 200);
  assert.equal(retry.body.receipt.stockouts[0].state, "QUEUED");
  assert.equal(f.commits.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.commits[0].p_jobs)), [
    { barcode: "BAD5-2" },
  ]);
  assert.equal(f.commits[0].p_version, "version");
  assert.equal(
    (await f.finish([observations[0], { ...observations[1], quantity: 3 }]))
      .status,
    409,
  );
  const stale = fixture({ replaced: true });
  assert.equal((await stale.finish()).status, 409);
  assert.equal(stale.commits.length, 0);
});

test("PC opens only the fixed stock page and never submits a marketplace action on wake or repeat", async () => {
  const calls = [];
  let tabs = [];
  const config = {
    allowBusiness: true,
    endpoint: "https://ops.example/api/mobile-work-center",
    agentToken: "test",
  };
  const http = async (url, options) => {
    calls.push([url, options]);
    if (url.startsWith("https:")) return Response.json({ pending: true });
    if (url.endsWith("/list")) return Response.json(tabs);
    tabs = [{ type: "page", url: decodeURIComponent(url.split("/new?")[1]) }];
    return Response.json({});
  };
  await wakePickingDispatch({ ...config, allowBusiness: false }, http);
  assert.equal(calls.length, 0);
  await wakePickingDispatch(config, http);
  await wakePickingDispatch(config, http);
  assert.equal(
    tabs[0].url,
    "https://ops.example/china-order-manager/stock-control?pickingDispatch=1",
  );
  assert.equal(calls.filter(([, o]) => o.method === "PUT").length, 1);
  assert.ok(
    calls
      .filter(([u]) => u.startsWith("http:"))
      .every(([, o]) => !o.headers?.Authorization),
  );
});

test("only the authenticated owner can finalize a Kakao share from the Ops origin", async () => {
  let identity = 401;
  let writes = 0;
  const { POST } = loadModule(
    "../src/app/api/picking/[token]/finish/route.ts",
    {
      "@/lib/mobileWorkCenterAuth": {
        mobileWorkCenterConfig: () => ({
          origin: "https://ops.example",
          ownerId: "owner",
        }),
        verifyMobileWorkCenterOwner: async () => identity,
      },
      "@/lib/pickingInventoryFinish": {
        finishPickingInventory: async () => {
          writes++;
          return { status: 200, body: { ok: true } };
        },
      },
    },
  );
  const post = (origin) =>
    POST(
      new Request("https://ops.example/api/picking/test/finish", {
        method: "POST",
        headers: { origin },
        body: "{}",
      }),
      { params: Promise.resolve({ token: "test" }) },
    );
  assert.equal((await post("https://ops.example")).status, 401);
  identity = 403;
  assert.equal((await post("https://ops.example")).status, 403);
  identity = 200;
  assert.equal((await post("https://other.example")).status, 403);
  assert.equal(writes, 0);
  assert.equal((await post("https://ops.example")).status, 200);
  assert.equal(writes, 1);
});

test("the production inventory builder writes exact zero without a sale-state command and rejects a reassigned model", async () => {
  const control=loadModule("../src/lib/inventoryStockControl.ts",{
    "@/lib/chinaOrderLedger":{}, "@/lib/productDecisionLiveRefresh":{}, "@/lib/stage8CanonicalSalesEventSnapshot":{},
    "@/lib/supabase/admin":{}, "@/lib/shoplingStockResponsibility":{},
  });
  const stocktake=loadModule("../src/lib/inventoryStocktakeBaselines.ts",{
    "@/lib/inventoryStockControl":control, "@/lib/productDecisionLiveRefresh":{}, "@/lib/supabase/admin":{},
  });
  const preflight = await import("../src/lib/shoplingStockBatchPreflight.ts");
  const {processUnifiedInventoryBatch}=loadModule("../src/lib/unifiedInventoryBatch.ts",{
    "@/lib/inventoryStockControl":control,"@/lib/inventoryStockBulkStore":{},"@/lib/shoplingDirectCommand":direct,
    "@/lib/inventoryManualOnSale":{},"@/lib/opsLoginBypass":{},"@/lib/inventoryStocktakeBaselines":stocktake,
    "@/lib/inventoryStockEstimateBaselines":{},"@/lib/inventoryShoplingRetransmission":{SHOPLING_STOCK_RETRANSMISSION_REQUEST_OPERATION_TYPE:"command"},
    "@/lib/shoplingStockBatchPreflight":preflight,
    "@/lib/productMasterInventoryIdentity":{normalizeInventoryBarcode:v=>v,
      loadProductMasterInventoryIdentities:async codes=>codes.map(barcode=>({barcode,state:"READY",productKind:"OPTION",modelNo:"AAA167"}))},
    "@/lib/shopling/shoplingStockBatchService":{prepareShoplingStockBatch:async jobs=>({products:[],items:jobs.map(job=>({...job,dependencies:[],stockBatchPlan:"signed"}))})},
  });
  const inputs={batchId:"picking-list",stockPlanVersion:1,stockoutBarcodes:["BAD5-2"],stocktakeItems:[{barcode:"BAF5-1",baselineQuantity:0}]};
  const models=new Map([["BAD5-2",["AAA167"]],["BAF5-1",["AAA167"]]]);
  let writes=0;
  const write=async(rows,jobs)=>{
    writes++;
    assert.deepEqual(Array.from(jobs,j=>j.barcode),["BAD5-2"]);
    const counted=rows.find(r=>r.operationType===stocktake.INVENTORY_STOCKTAKE_BASELINE_OPERATION_TYPE);
    assert.equal(counted.snapshot.baselineQuantity,0);
    assert.equal(counted.snapshot.observationSource,"PICKING_COUNT");
    assert.equal(rows.find(r=>r.operationType==="command").snapshot.items.length,1);
    return {insertedCount:0};
  };
  assert.equal((await processUnifiedInventoryBatch(inputs,write,models)).status,200);
  models.set("BAF5-1",["AAA999"]);
  assert.equal((await processUnifiedInventoryBatch(inputs,write,models)).ok,false);
  assert.equal(writes,1);
});
