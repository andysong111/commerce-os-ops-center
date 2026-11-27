import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './monthly-price-module.mjs';
import { readFileSync } from 'node:fs';
const followup = loadModule('../src/lib/internalChinaReceiptFollowupCore.ts', {});
const core = loadModule('../src/lib/receiptOnSaleCore.ts', { './internalChinaReceiptFollowupCore': followup });
const draftId = 'fast-purchase-draft:0123456789abcdef0123';
const id = '33333333-3333-4333-8333-333333333333';
const barcode = 'BBA1-1', jobId = 'receipt-onsale:' + id + ':' + barcode;
const row = { barcode, productKind:'OPTION', desiredStatus:'ON_SALE', exactInventoryQuantity:5, syncNeeded:false, salesCoverageReady:true, goodsKeys:['10001'] };
const report = { state:'READY', rows:[row] };
function receipt(id, code, qty, date='2026-11-21') {
  return { input_snapshot:{barcode:code, sourceSystem:'fast-purchase-mvp', sourceRunId:draftId, status:'RECEIVED', occurredAt:date, payload:{receiptId:id,draftId}},
    result_snapshot:{barcode:code, accepted:true, receiptId:id, receivedNow:qty, draftId, cycleMonth:'2026-11', followupVersion:1, receiptLineCount:1} };
}
function evidence(job=jobId) {
  return { stockPlanComplete:true, stockStateGroupReceipts:['OPTION_SEND','PRODUCT_SALE_STATUS_SEND'].map((kind,i) => ({
    transmissionKind:kind, goodsKeys:['10001'], acceptedPopupTabId:5+i,
    evidence:{originalSubmitReceipt:{receiptKey:job+':execution:'+(i?'SINGLE':'OPTION')+':10001', assignmentOwnerKey:job+':execution:'+(i?'SINGLE':'OPTION')+':10001', productKind:i?'SINGLE':'OPTION',popupFrameId:0,topChecked:true,targetChecked:true,desiredStatus:'ON_SALE', goodsKeyQuery:'10001',popupTabId:5+i,
      submitDispatchMethod:'ORIGINAL_SHOPLING_FUNCTION',shoplingSubmitInvoked:true,submitConfirmSeen:true,submitControlVerified:true}}
  })) };
}
test('confirmed receipt, already on sale, zero stock and incomplete evidence', () => {
  const rec=receipt(id,barcode,4);
  const [target]=core.receiptOnSaleTargets(draftId,[rec,{result_snapshot:{actualOrderEvidenceReconciled:true,draftId}}]);
  assert.equal(target.quantity,4);
  assert.match(core.receiptOnSaleState(target,report,[]).message,/덮어쓰기/);
  for(const patch of [{exactInventoryQuantity:0},{salesCoverageReady:false},{manualStatusOnly:true},{syncBlocked:true},{latestSyncOutcome:'UNCERTAIN'}]) {
    assert.equal(core.receiptOnSaleState(target,{...report,rows:[{...row,...patch}]},[]).canStart,false);
  }
  assert.throws(()=>core.receiptOnSaleTargets(draftId,[{...rec,result_snapshot:{...rec.result_snapshot,draftId:'other'}}]));
  assert.throws(()=>core.receiptOnSaleTargets(draftId,[{...rec,result_snapshot:{...rec.result_snapshot,receiptLineCount:2}}]));
  const later=receipt(id.replace('33333333','44444444'),barcode,2,'2026-11-22');
  const [latest]=core.receiptOnSaleTargets(draftId,[later,rec]);
  assert.equal(latest.quantity,6);assert.notEqual(latest.jobId,jobId);
  const prior=core.receiptOnSaleState(latest,report,[{outcome:'STARTED',jobId,barcode}]);
  assert.equal(prior.jobId,jobId);assert.equal(prior.state,'STARTED');assert.equal(prior.canStart,false);
});
test('each approved goods key and lane must have a distinct original popup receipt', () => {
  const expected=['OPTION_SEND:10001','PRODUCT_SALE_STATUS_SEND:10001'];
  assert.ok(core.receiptOnSaleProof(evidence(),expected,jobId));
  for (const mutate of [
    e=>e.stockStateGroupReceipts.pop(),
    e=>e.stockStateGroupReceipts[1].goodsKeys.push('19999'),
    e=>e.stockStateGroupReceipts[0].evidence.originalSubmitReceipt.submitControlVerified=false,
    e=>e.stockStateGroupReceipts[0].evidence.originalSubmitReceipt.receiptKey='another job',
    e=>e.stockPlanComplete=false,
  ]) { const e=evidence();mutate(e);assert.equal(core.receiptOnSaleProof(e,expected,jobId),false); }
});
function harness(){
  const dbRows=[{...receipt(id,barcode,4),status:'SUCCEEDED',operation_type:'CHINA_ORDER_COMMITMENT_EVENT',source:'ops-center-internal-china-receipt'}], ids=new Set();
  const db={from(){const predicates=[];
    const get=(r,k)=>k==='result_snapshot->>draftId'?r.result_snapshot.draftId:r[k];
    const q={select(){return q},eq(k,v){predicates.push(r=>get(r,k)===v);return q},in(k,v){predicates.push(r=>v.includes(r[k]));return q},order(){return q},
      range:async()=>({data:structuredClone(dbRows.filter(r=>predicates.every(fn=>fn(r)))),error:null})};return q;}};
  const store=loadModule('../src/lib/receiptOnSaleStore.ts',{
    '@/lib/supabase/admin':{createSupabaseAdminClient:async()=>db},'./internalChinaReceiptFollowupCore':followup,
    './monthlyPriceCore':{purchaseRunDraftId:d=>d},'./receiptOnSaleCore':core,
    './inventoryStockAuthoritativeReport':{loadAuthoritativeInventoryStockReport:async()=>({report})},
    './shopling/shoplingGoodsKeyTransmission':loadModule('../src/lib/shopling/shoplingGoodsKeyTransmission.ts',{}),
    './shopling/shoplingStockBatchService':{prepareShoplingStockBatch:async()=>({products:[{goodsKey:'10001',productSaleStatus:'B',options:[{},{}],finalizeBarcode:barcode,parentDesiredStatus:'ON_SALE'}],items:[{stockBatchPlan:'signed'}]})},
    './inventoryStockControl':{normalizeShoplingStockSyncInput:r=>r,SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE:'sync',
      storeInventoryOperation:async o=>{if(ids.has(o.sourceEventId))return {duplicate:true};ids.add(o.sourceEventId);
        dbRows.push({status:'SUCCEEDED',operation_type:o.operationType,correlation_id:o.correlationId,input_snapshot:o.snapshot});return {duplicate:false}}}
  });return {store,dbRows};
}
test('two concurrent claims dispatch once, reload holds unknown success, exact original receipt recovers without resend',async()=>{
  const {store}=harness();
  assert.equal((await store.readReceiptOnSaleStatus('other')).length,0);
  await assert.rejects(store.claimReceiptOnSale('other',jobId));
  const results=await Promise.allSettled([store.claimReceiptOnSale(draftId,jobId),store.claimReceiptOnSale(draftId,jobId)]);
  assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value.job?.stockBatchPlan==='signed').length,1);
  assert.equal((await store.readReceiptOnSaleStatus(draftId))[0].state,'STARTED');
  await store.finishReceiptOnSale(draftId,{jobId,barcode,outcome:'SUCCEEDED',evidence:{stockPlanComplete:true}});
  assert.equal((await store.readReceiptOnSaleStatus(draftId))[0].state,'HELD');
  await assert.rejects(store.claimReceiptOnSale(draftId,jobId));
  await store.finishReceiptOnSale(draftId,{jobId,barcode,outcome:'SUCCEEDED',evidence:evidence()});
  assert.equal((await store.readReceiptOnSaleStatus(draftId))[0].state,'ACCEPTED');
  await assert.rejects(store.claimReceiptOnSale(draftId,jobId));
});
test('market failures remain visible after the original submissions were accepted',async()=>{
  const {store}=harness();await store.claimReceiptOnSale(draftId,jobId);
  await store.finishReceiptOnSale(draftId,{jobId,barcode,outcome:'SUCCEEDED',evidence:{...evidence(),marketFailureCount:2}});
  const [r]=await store.readReceiptOnSaleStatus(draftId);
  assert.equal(r.state,'HELD');assert.match(r.message,/마켓 실패 표시 2건/);assert.equal(r.canStart,false);
});
test('purchase workspace includes the real extension bridge alongside both entry points',()=>{
  const page=readFileSync('src/app/china-order-manager/page.tsx','utf8');
  assert.match(page,/<StockSyncHF15Bridge \/>/);assert.match(page,/<ReceiptOnSalePanel key=\{selectedDraftId\} draftId=\{selectedDraftId\}/);
  const ui=readFileSync('src/components/china-order-manager/InternalChinaReceiptPanel.tsx','utf8');
  assert.match(ui,/runInboundReceiptOnSaleSync\(\s*draftId, setNotice/);
});
