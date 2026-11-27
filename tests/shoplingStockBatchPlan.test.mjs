import assert from "node:assert/strict";
import test from "node:test";
import { buildStockBatchPlan, signStockItemPlan, verifyStockItemPlan, validateStockProductStep } from "../src/lib/shopling/shoplingStockBatchPlan.ts";
import * as planner from "../src/lib/shopling/shoplingStockBatchPlan.ts";
import * as transmission from "../src/lib/shopling/shoplingGoodsKeyTransmission.ts";
import * as simpleXml from "../src/lib/shopling/simpleXml.ts";
import { loadModule } from "./monthly-price-module.mjs";
import * as directCommand from "../src/lib/shoplingDirectCommand.ts";
import * as preflight from "../src/lib/shoplingStockBatchPreflight.ts";

const codes = ["BCD8-1", "BCD8-2"];

test("each explicit command covers every input after past successes and failures; a duplicate HTTP submit cannot dispatch twice", async () => {
  const persisted = new Map();
  const table = {
    insert: rows => ({select: async () => {
      if (rows.some(r => persisted.has(r.source_event_id))) return {error:{code:"23505"}};
      for (const row of rows) persisted.set(row.source_event_id, row.input_snapshot);
      return {data:rows};
    }}),
    select: () => ({in: (_field, ids) => ({limit: async () => ({
      data: ids.filter(id => persisted.has(id)).map(source_event_id => ({source_event_id})),
    })})}),
  };
  const store = loadModule("../src/lib/inventoryStockBulkStore.ts", {
    "@/lib/supabase/admin": {createSupabaseAdminClient: async () => ({from: () => table})},
  });
  const {POST} = loadModule("../src/app/api/inventory-stock-control/unified-batch/route.ts", {
    "@/lib/opsLoginBypass": {isSameOriginOpsRequest: () => true},
    "@/lib/inventoryStockControl": {INVENTORY_STOCKOUT_RESET_OPERATION_TYPE:"reset", normalizeStockoutResetInput:v=>v},
    "@/lib/inventoryManualOnSale": {INVENTORY_MANUAL_ON_SALE_OPERATION_TYPE:"sale", normalizeInventoryManualOnSaleInput:v=>v},
    "@/lib/inventoryStockBulkStore": store, "@/lib/shoplingDirectCommand": directCommand,
    "@/lib/inventoryStocktakeBaselines": {}, "@/lib/inventoryStockEstimateBaselines": {},
    "@/lib/inventoryShoplingRetransmission": {SHOPLING_STOCK_RETRANSMISSION_REQUEST_OPERATION_TYPE:"command"},
    "@/lib/productMasterInventoryIdentity": {normalizeInventoryBarcode:v=>v, loadProductMasterInventoryIdentities:async values=>values.map(barcode=>({barcode, state:"READY", productKind:"OPTION"}))},
    "@/lib/shoplingStockBatchPreflight": preflight,
    "@/lib/shopling/shoplingStockBatchService": {prepareShoplingStockBatch:async jobs=>({products:[], items:jobs.map(j=>({...j, stockBatchPlan:"signed", dependencies:[]}))})},
  });
  const submit = (batchId, stockoutBarcodes, onSaleBarcodes) => POST(new Request("https://example.invalid/api/unified-batch", {
    method:"POST", body:JSON.stringify({batchId, stockoutBarcodes, onSaleBarcodes, stockPlanVersion:1, occurredAt:"2026-11-27T04:00:00.000Z"}),
  }));
  const ids = new Set();
  for (const [batchId, sold, sale] of [["first",[],codes],["second",[],codes],["reverse",codes,[]],["mixed",[codes[0]],[codes[1]]]]) {
    const res = await submit(batchId,sold,sale);
    assert.equal(res.status,201);
    const payload = await res.json();
    const jobs = directCommand.verifyDirectStockCommand(batchId,sold,sale,payload);
    assert.deepEqual(jobs.map(j=>j.barcode),[...sold,...sale]);
    assert.ok(jobs.every(j=>!ids.has(j.jobId)));
    jobs.forEach(j=>ids.add(j.jobId));
    assert.deepEqual(persisted.get("shopling-stock-retransmission:"+payload.commandRequestId).items.map(j=>j.jobId).join(","),jobs.map(j=>j.jobId).join(","));
    assert.throws(()=>directCommand.verifyDirectStockCommand(batchId,sold,sale,{...payload,jobs:jobs.slice(0,1)}),/BCD8-2/);
    assert.throws(()=>directCommand.verifyDirectStockCommand(batchId,sold,sale,{...payload,jobs:[jobs[0],jobs[0]]}),/BCD8-2/);
    assert.throws(()=>directCommand.verifyDirectStockCommand("foreign",sold,sale,payload),/실행번호/);
  }
  const count = persisted.size;
  assert.equal((await submit("first",[],codes)).status,409);
  assert.equal((await submit("first",["BCC5-1"],[])).status,409);
  assert.equal(persisted.size,count);
  const concurrent = await Promise.all([submit("race",[],codes),submit("race",[],codes)]);
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[201,409]);
});
const options = (states = "CC", parent = "C", goodsKey = "120867") => [...states].map((optionStatus, i) => ({
  goodsKey, productName: "컨트롤러 레이싱그립", partnerGoodsCode: "AAA365", productSaleStatus: parent,
  optionId: String(4416178 + i), partnerOptionCode: codes[i] || "", optionQuantity: "999", optionStatus,
  selection: [{ title: "기종", value: ["PS4", "PS5", "PS6"][i] }],
}));
const item = (index, desiredStatus = "ON_SALE", productKind = "OPTION") => ({ barcode: codes[index], desiredStatus, productKind, goodsKeys: [] });
function plan(items, rows) {
  const keys = [...new Set(rows.map((row) => row.goodsKey))];
  return buildStockBatchPlan(items, new Map(items.map((i) => [i.barcode, keys])), rows);
}

test("BCD8 readback on 2026-11-27: both live options and all six Shopling parents already B still require a final market send for all six goods keys", () => {
  const goodsKeys = ["120867", "120868", "120869", "120870", "120871", "120872"];
  const rows = goodsKeys.flatMap((key, i) => {
    const pair = options("BB", "B", key);
    return i < 4 ? pair : pair.reverse();
  });
  const { plans, products } = plan([item(0), item(1)], rows);
  assert.equal(products.length, 6);
  assert.ok(products.every(p => p.beforeAvailability === "ALL_ON_SALE" && p.finalizeBarcode === "BCD8-2"));
  assert.ok(plans[0].steps.every(s => s.applyOption && s.parentDesiredStatus === null));
  assert.deepEqual(plans[1].dependencies, ["BCD8-1"]);
  assert.deepEqual(plans[1].steps.filter(s => s.applyOption && s.parentDesiredStatus === "ON_SALE").map(s => s.goodsKey), goodsKeys);
});

test("AAA365 two-option restoration finalizes each live GOODS_KEY on its last B-code even when the Shopling parent already says on sale", () => {
  const {plans, products} = plan([item(0), item(1)], [...options(), ...options("BB", "B", "123456"), ...options("CC", "E", "654321")]);
  assert.deepEqual(plans[0].steps.map((p) => p.parentDesiredStatus), [null, null, null]);
  assert.deepEqual(plans[1].steps.map((p) => p.parentDesiredStatus), ["ON_SALE", "ON_SALE", null]);
  assert.deepEqual(plans[1].dependencies, [codes[0]]);
  assert.equal(products[0].beforeAvailability, "ALL_SOLD_OUT");
  assert.equal(products[0].afterAvailability, "ALL_ON_SALE");
  assert.deepEqual(products[0].options.map((o) => o.selection[0].value), ["PS4", "PS5"]);
  assert.deepEqual(products[2].options.map((o) => o.plannedStatus), ["C", "C"]);
});

test("partial stockout leaves the parent for the untouched sibling; last stockout and mixed finalizer use the aggregate direction", () => {
  assert.equal(plan([item(0,"SOLD_OUT")], options("BB","B")).plans[0].steps[0].parentDesiredStatus, null);
  assert.equal(plan([item(0,"SOLD_OUT")], options("BC","B")).plans[0].steps[0].parentDesiredStatus, "SOLD_OUT");
  const mixed = plan([item(0), item(1,"SOLD_OUT")], options("CB","C"));
  assert.equal(mixed.products[0].afterAvailability,"PARTIAL_SOLD_OUT");
  assert.equal(mixed.plans[1].steps[0].parentDesiredStatus,"ON_SALE");
  assert.equal(plan([item(0,"SOLD_OUT")], options("BCB","B")).plans[0].steps[0].parentDesiredStatus,null);
  const [single] = plan([item(0,"SOLD_OUT","SINGLE")], options("B","B")).plans;
  assert.equal(single.steps[0].applyOption,false);
  assert.equal(single.steps[0].parentDesiredStatus,"SOLD_OUT");
  assert.equal(plan([item(0,"SOLD_OUT")], options("B","B")).plans[0].steps[0].applyOption,true);
});

test("unknown state, ambiguous selection, kind mismatch and stale projections stop without escalating to a product write", () => {
  assert.throws(() => plan([item(0)], options("CX")), /OPTION_STATUS_TRANSITION_BLOCKED:X/);
  assert.throws(() => plan([item(0)], options("CC","D")), /PRODUCT_STATUS_TRANSITION_BLOCKED:D/);
  assert.throws(() => plan([item(0,"ON_SALE","SINGLE")], options()), /PRODUCT_KIND_MISMATCH/);
  const duplicate = options();
  duplicate[1].selection = duplicate[0].selection;
  assert.throws(() => plan([item(0)], duplicate), /AMBIGUOUS_OPTIONS/);
  const step = plan([item(0),item(1)], options()).plans[1].steps[0];
  assert.throws(() => validateStockProductStep(step,options(),"BEFORE"), /PLAN_STALE/);
  validateStockProductStep(step,options("BC"),"BEFORE");
  validateStockProductStep(step,options("BB"),"OPTIONS_APPLIED");
  assert.throws(() => validateStockProductStep(step,options("BB"),"COMPLETE"), /PLAN_STALE/);
  validateStockProductStep(step,options("BB","B").reverse(),"COMPLETE");
  for (const field of ["optionQuantity","optionId","partnerOptionCode","partnerGoodsCode","productSaleStatus"]) {
    const changed = options("BB","B");
    changed[1][field] += "X";
    assert.throws(() => validateStockProductStep(step,changed,"COMPLETE"),/PLAN_STALE/);
  }
  const token = signStockItemPlan(plan([item(0)],options()).plans[0],"test-secret",100);
  assert.equal(verifyStockItemPlan(token,"test-secret",200).barcode,codes[0]);
  assert.throws(() => verifyStockItemPlan("A"+token,"test-secret",200), /PLAN_INVALID/);
  assert.throws(() => verifyStockItemPlan(token,"test-secret",100 + 8*3600_000), /PLAN_EXPIRED/);
});

function server(rows) {
  const writes = [];
  const keys = [...new Set(rows.map((r) => r.goodsKey))];
  const config = {loginId:"test",companyId:"test",authKey:"fixture",productsUrl:"fixture:read"};
  const readConfig = {shoplingReadConfigFromEnv:()=>config};
  const xml = (value) => ({ok:true,status:200,text:async()=>value});
  const api = {postShoplingXml: async (url, body) => {
    if (url === config.productsUrl) {
      const requested = body.match(/<prod_id><!\[CDATA\[([^\]]+)/)[1].split(",");
      const goods = requested.map((key) => {
        const group = rows.filter((r) => r.goodsKey === key);
        if (!group.length) return "";
        return `<goodsInfo><goods_key>${key}</goods_key><ptn_goods_cd>AAA365</ptn_goods_cd><prod_nm>컨트롤러</prod_nm><sale_status>${group[0].productSaleStatus}</sale_status><options>
          <optList><title>기종</title><value>${group.map(r=>r.selection[0].value)}</value></optList><optId>${group.map(r=>r.optionId)}</optId><optStatus>${group.map(r=>r.optionStatus)}</optStatus><optQty>${group.map(r=>r.optionQuantity)}</optQty><optPtnOptCd>${group.map(r=>r.partnerOptionCode)}</optPtnOptCd></options></goodsInfo>`;
      }).join("");
      return xml("<rspns><apiProdGather>"+goods+"</apiProdGather></rspns>");
    }
    const key = body.match(/<goods_key>(?:<!\[CDATA\[)?(\d+)/)[1];
    const group = rows.filter((r) => r.goodsKey === key);
    if (body.includes("<optStatus>")) {
      const selection = body.match(/<value><!\[CDATA\[([^\]]+)/)[1];
      const status = body.match(/<optStatus>([BC])</)[1];
      group.find((r) => r.selection[0].value === selection).optionStatus = status;
      writes.push(["option", key, selection, status]);
    } else {
      const status = body.match(/<sale_status>([BC])</)[1];
      group.forEach((r) => r.productSaleStatus = status);
      writes.push(["product",key,status]);
    }
    assert.doesNotMatch(body, /optQty|optPtnOptCd|barcode|location/i);
    return xml(`<rspns><apiProdMdyRst><goodsRst><goods_key>${key}</goods_key><code>000</code></goodsRst><succs_cnt>1</succs_cnt><fail_cnt>0</fail_cnt></apiProdMdyRst></rspns>`);
  }};
  const prefix = "@/lib/shopling/";
  const option = loadModule("../src/lib/shopling/shoplingOptionStatus.ts",{
    [prefix+"simpleXml"]:simpleXml,[prefix+"shoplingReadClient"]:readConfig,[prefix+"shoplingTlsTransport"]:api,
  });
  const product = loadModule("../src/lib/shopling/shoplingProductStatus.ts",{
    [prefix+"shoplingOptionStatus"]:option,[prefix+"shoplingReadClient"]:readConfig,[prefix+"shoplingTlsTransport"]:api,
    "@/lib/monthlyPriceShopling":{buildMonthlySaleStatusWriteXml:(key, state)=>`<goods_key>${key}</goods_key><sale_status>${state}</sale_status>`,assertMonthlyWriteAcknowledgement:()=>{}},
  });
  const batch = loadModule("../src/lib/shopling/shoplingStockBatchService.ts",{
    "./shoplingOptionStatus":option,"./shoplingReadClient":readConfig,"./shoplingStockBatchPlan":planner,
    "./shoplingBcodeIndex":{loadIndexedShoplingGoodsKeys: async()=>keys},
  });
  const route = loadModule("../src/app/api/inventory-stock-control/shopling-option-status/route.ts",{
    [prefix+"shoplingOptionStatus"]:option,[prefix+"shoplingProductStatus"]:product,[prefix+"shoplingStockBatchService"]:batch,
    [prefix+"shoplingStockBatchPlan"]:planner,[prefix+"shoplingGoodsKeyTransmission"]:transmission,
    "@/lib/opsLoginBypass":{isSameOriginOpsRequest:()=>true},"@/lib/shoplingStockFailureDetail":{buildShoplingBlockedTransitionDetail:()=>null},
  });
  return {writes, post: async(body)=>(await route.POST(new Request("https://example.invalid/api",{method:"POST",body:JSON.stringify(body)}))).json()};
}

test("batch HTTP preflight makes zero writes and the actual apply route orders options then parent across listings with final readback", async () => {
  const rows = [...options(), ...options("CC","B","123456"), ...options("CC","E","654321")];
  const {post,writes} = server(rows);
  const items = [item(0), item(1)];
  const prep = await post({mode:"PREFLIGHT_BATCH",items});
  assert.equal(prep.ok,true);
  assert.deepEqual(writes,[]);
  const send = (i) => post({...items[i],planVersion:2,stockBatchPlan:prep.result.items[i].stockBatchPlan});
  assert.equal((await send(1)).ok,false);
  assert.deepEqual(writes,[]);
  const first = await send(0);
  assert.equal(first.ok,true,first.message);
  assert.equal(first.result.transmissions.length,2);
  assert.ok(first.result.transmissions.every((t)=>t.transmissionKind==="OPTION_SEND"));
  const last = await send(1);
  assert.equal(last.ok,true,last.message);
  assert.equal(last.result.planVersion,2);
  assert.deepEqual(last.result.transmissions.map((t)=>[t.goodsKey,t.transmissionKind]),[
    ["120867","OPTION_SEND"],["123456","OPTION_SEND"],["120867","PRODUCT_SALE_STATUS_SEND"],["123456","PRODUCT_SALE_STATUS_SEND"],
  ]);
  assert.equal(last.result.skippedEndedCount,1);
  assert.equal(writes.length,5);
  assert.ok(rows.every((r)=>r.optionQuantity==="999" && (r.goodsKey==="654321" ? r.optionStatus==="C" && r.productSaleStatus==="E" : r.optionStatus==="B" && r.productSaleStatus==="B")));
  const replay = await send(1);
  assert.equal(replay.result.mutatedCount,0);
  assert.equal(writes.length,5);
});

test("later invalid listings and incompatible legacy clients cause zero writes; partial stockout preserves other options", async () => {
  const rows = [...options("BB","B"),...options("BX","B","123456")];
  const {post,writes} = server(rows);
  assert.equal((await post({mode:"PREFLIGHT_BATCH",items:[item(0,"SOLD_OUT")]})).ok,false);
  assert.deepEqual(writes,[]);
  rows[3].optionStatus = "C";
  assert.equal((await post(item(0,"SOLD_OUT"))).ok,false);
  assert.deepEqual(writes,[]);
  const { result } = await post({mode:"PREFLIGHT_BATCH",items:[item(0,"SOLD_OUT")]});
  const {stockBatchPlan} = result.items[0];
  assert.equal((await post({...item(0,"SOLD_OUT"),stockBatchPlan})).ok,false);
  assert.equal((await post({...item(0,"SOLD_OUT"),planVersion:2})).ok,false);
  assert.deepEqual(writes,[]);
  const accepted = await post({...item(0,"SOLD_OUT"),planVersion:2,stockBatchPlan});
  assert.equal(accepted.ok,true,accepted.message);
  assert.deepEqual(accepted.result.productStatusGoodsKeys,["123456"]);
  assert.equal(rows[1].optionStatus,"B");
  assert.equal(rows[0].productSaleStatus,"B");
  assert.equal(rows[2].productSaleStatus,"C");
});

test("Task 4's stockout-only batch includes the signed plan before storing a baseline; a failed preflight leaves no baseline", async () => {
  const events = [];
  let deny = true;
  const planner = {
    prepareShoplingStockBatch: async (jobs) => {
      events.push("preflight");
      if (deny) throw new Error("SHOPLING_STOCK_BATCH_PRODUCT_MISSING:120867");
      return {items:jobs.map((j,i)=>({...j,stockBatchPlan:"signed-plan-"+i,dependencies:i ? [jobs[0].barcode] : []}))};
    },
  };
  const preflight = loadModule("../src/lib/shoplingStockBatchPreflight.ts",{});
  const {POST} = loadModule("../src/app/api/inventory-stock-control/batch/route.ts", {
    "@/lib/inventoryStockControl": {normalizeStockoutResetInput:(v)=>v,INVENTORY_STOCKOUT_RESET_OPERATION_TYPE:"stockout"},
    "@/lib/inventoryStockBulkStore": {storeInventoryOperationBatch:async (rows)=>{events.push("store");return {count:rows.length};}},
    "@/lib/shopling/shoplingStockBatchService": planner, "@/lib/shoplingStockBatchPreflight":preflight,
    "@/lib/opsLoginBypass": {isSameOriginOpsRequest:()=>true},
    "@/lib/productMasterInventoryIdentity": {normalizeInventoryBarcode:(v)=>v,
      loadProductMasterInventoryIdentities:async (barcodes)=>barcodes.map(barcode=>({barcode,state:"READY",productKind:"OPTION",modelNo:"AAA365"}))},
  });
  const post = () => POST(new Request("https://example.invalid/api/batch",{method:"POST",
    body:JSON.stringify({batchId:"task4",stockPlanVersion:1,barcodes:codes})}));
  assert.equal((await post()).ok,false);
  assert.deepEqual(events,["preflight"]);
  deny = false;
  const response = await (await post()).json();
  assert.ok(response.ok);
  assert.deepEqual(response.jobs.map(j=>j.stockBatchPlan),["signed-plan-0","signed-plan-1"]);
  assert.deepEqual(response.jobs[1].stockBatchDependencies,[codes[0]]);
  assert.deepEqual(events,["preflight","preflight","store"]);
});
