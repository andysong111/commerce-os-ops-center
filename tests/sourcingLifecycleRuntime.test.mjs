import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import {
  summarizeStoredReceiptReplay,
  validReceiptRequestId,
} from '../src/domain/china-receipt-request.ts';

// Run the actual checked-in production functions with explicit, isolated I/O.
// No application imports, real credentials, or external fetches enter these tests.
async function load(path, exported, dependencies) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const withoutImports = source.replace(/^import[\s\S]*?from ["'][^"']+["'];\s*/gm, '');
  const js = stripTypeScriptTypes(withoutImports).replace(/^export\s+(?=(?:async\s+)?function|const)/gm, '');
  return new Function(...Object.keys(dependencies), '"use strict";\n' + js + '\nreturn ' + exported + ';')(...Object.values(dependencies));
}
const clone = value => structuredClone(value);
const receiptId = '11111111-1111-4111-8111-111111111111';
const intakeId = '22222222-2222-4222-8222-222222222222';
const outboxId = '33333333-3333-4333-8333-333333333333';
const ownerId = '44444444-4444-4444-8444-444444444444';
const input = () => ({ intakeId, receiptId, barcode:'BBA8-1', modelNumber:'AAA1000', productName:'소싱 수납함', unitCostKrw:2500, saleOption:'검정', chinaOption:'黑色', supplierLink:'https://detail.1688.com/offer/123456.html', sourceLineId:'draft:line' });

async function launchBackend(options = {}) {
  let stored = { updated_at:'2026-09-20T01:00:00.000Z', state_payload:{schemaVersion:3,items:[]}};
  const normalized = new Map(), calls = [];
  let lost = options.loseWriteOnce, syncFailure = options.failSyncOnce, numberFailure = options.failNumberOnce, injected = false;
  const dependencies = {
    temporaryOpsIdentity: () => ({userId:ownerId,email:'fixture@example.test'}),
    getProductLaunchAdminConfig: () => ({ok:true,value:{supabaseUrl:'https://fixture.test',secretKey:'synthetic-only'}}),
    readProductLaunchState: async () => options.missingState ? null : clone(stored),
    readProductLaunchNormalizedItem: async (_c,_o,id) => clone(normalized.get(id) || null),
    readProductLaunchNormalizedWorkspace: async () => options.missingWorkspace ? null : {normalized_read_enabled:true},
    normalizeNewProductLaunchState: value => clone(value),
    withProductLaunchListSnapshot: value => clone(value),
    createSupabaseAdminHeaders: () => ({'content-type':'application/json'}),
    syncProductLaunchNormalizedChangedItems: async (_c,_o,state,_updated,ids) => {
      calls.push('normalize');
      if (syncFailure) {syncFailure=false;throw Error('SYNC_OFFLINE');}
      for (const id of ids) normalized.set(id,clone(state.items.find(i=>i.id===id)));
      return {synced:true};
    },
    fetch: async (raw,init) => {
      const url = new URL(raw);
      if (url.pathname.endsWith('/rpc/ensure_product_launch_item_option_barcode_nos')) {
        calls.push('number');
        if (numberFailure) {numberFailure=false;return Response.json({}, {status:503});}
        const item = normalized.get(JSON.parse(init.body).p_item_id);
        if (item) for(const option of item.orderOptions || []) option.optionBarcodeNo ||= '000000001001';
        return Response.json({ok:true});
      }
      assert.equal(url.pathname,'/rest/v1/product_launch_tracker_states');
      assert.equal(url.searchParams.get('owner_id'),'eq.'+ownerId);
      assert.equal(init.method,'PATCH');
      calls.push('compare-swap');
      if (options.alwaysConflict) return Response.json([]);
      if (options.concurrentEdit && !injected) {
        injected = true;
        stored.state_payload.items.push({id:'unrelated',modelNumber:'AAA999',barcode:'BBA7-1',notes:'동시 사용자 편집 보존',trackerRowNumber:7});
        stored.updated_at = new Date(Date.now()+1).toISOString();
      }
      if (url.searchParams.get('updated_at') !== 'eq.'+stored.updated_at) return Response.json([]);
      const body = JSON.parse(init.body);
      stored = {...stored,...body};
      if (lost) {lost=false;throw Error('RESPONSE_LOST_AFTER_COMMIT');}
      return Response.json([clone(stored)]);
    },
  };
  const run=await load('../src/lib/sourcingLaunchMaterialization.ts','materializeSourcingLaunchItem',dependencies);
  return {run,calls,normalized,get stored(){return stored;}};
}

test('actual materializer recovers an optimistic-lock collision without deleting another user edit',async()=>{
  const b=await launchBackend({concurrentEdit:true});await b.run(input());
  assert.equal(b.stored.state_payload.items.length,2);
  assert.equal(b.stored.state_payload.items.find(i=>i.id==='unrelated').notes,'동시 사용자 편집 보존');
  assert.equal(b.normalized.get(intakeId).trackerRowNumber,8);
  assert.equal(b.calls.filter(x=>x==='compare-swap').length,2);
});
test('actual materializer serializes two concurrent new source items through compare-and-swap',async()=>{
  const b=await launchBackend();
  const second={...input(),intakeId:'55555555-5555-4555-8555-555555555555',modelNumber:'AAA1001',barcode:'BBA8-2'};
  await Promise.all([b.run(input()),b.run(second)]);
  assert.equal(b.stored.state_payload.items.length,2);assert.equal(b.normalized.size,2);
  assert.equal(new Set(b.stored.state_payload.items.map(i=>i.trackerRowNumber)).size,2);
});
test('actual materializer repairs a lost legacy write response without issuing another product identity',async()=>{
  const b=await launchBackend({loseWriteOnce:true});
  await assert.rejects(b.run(input()),/RESPONSE_LOST/);assert.equal(b.stored.state_payload.items.length,1);assert.equal(b.normalized.size,0);
  await b.run(input());assert.equal(b.stored.state_payload.items.length,1);assert.equal(b.normalized.size,1);
  assert.equal(b.calls.filter(x=>x==='compare-swap').length,1);
});
test('actual materializer retries only missing normalized state after an interrupted mirror',async()=>{
  const b=await launchBackend({failSyncOnce:true});await assert.rejects(b.run(input()),/SYNC_OFFLINE/);
  await b.run(input());assert.equal(b.stored.state_payload.items.length,1);assert.equal(b.normalized.get(intakeId).modelNumber,'AAA1000');
});
test('actual materializer does not overwrite a later name, asset, category or physical move',async()=>{
  const b=await launchBackend();await b.run(input());
  const edited=b.normalized.get(intakeId);edited.productName='운영자 수정 상품명';edited.barcode='BBA7-3';edited.shoplingCategory='수납';edited.detailPageAsset={html:'<p>edited</p>'};
  const normalizations=b.calls.filter(x=>x==='normalize').length;
  await b.run(input());assert.equal(b.calls.filter(x=>x==='normalize').length,normalizations);
  assert.equal(b.normalized.get(intakeId).productName,'운영자 수정 상품명');
  assert.equal(b.normalized.get(intakeId).barcode,'BBA7-3');
  assert.deepEqual(b.normalized.get(intakeId).detailPageAsset,{html:'<p>edited</p>'});
});
test('actual materializer fails closed on absent source state or absent normalized workspace',async()=>{
  for(const options of [{missingState:true},{missingWorkspace:true}]){const b=await launchBackend(options);await assert.rejects(b.run(input()),/STATE_UNAVAILABLE|WORKSPACE_REQUIRED/);assert.deepEqual(b.calls,[]);}
});
test('actual materializer never falls back to a blind overwrite after repeated concurrent saves',async()=>{
  const b=await launchBackend({alwaysConflict:true});await assert.rejects(b.run(input()),/CONCURRENT_SAVE_RETRY/);
  assert.equal(b.calls.filter(x=>x==='compare-swap').length,4);assert.equal(b.normalized.size,0);assert.equal(b.stored.state_payload.items.length,0);
});
test('actual materializer repairs numbering failure without resetting saved work or generating another item',async()=>{
  const b=await launchBackend({failNumberOnce:true});await assert.rejects(b.run(input()),/OPTION_BARCODE_PENDING/);
  await b.run(input());assert.equal(b.stored.state_payload.items.length,1);assert.equal(b.normalized.size,1);
  assert.equal(b.normalized.get(intakeId).orderOptions[0].optionBarcodeNo,'000000001001');
});

async function receiptBackend(options={}) {
  const calls=[],stored=[];
  const draftId='fast-purchase-draft:0123456789abcdef0123';
  const commitment={sourceSystem:'fast-purchase-mvp',sourceRunId:draftId,sourceLineId:draftId+':BBA8-1',barcode:'BBA8-1',reservedAt:'2026-09-02T00:00:00.000Z',updatedAt:'2026-09-03T00:00:00.000Z',committedQuantity:5,orderedQuantity:options.unordered?0:5,receivedQuantity:0,cancelledQuantity:0,openQuantity:5,latestPayload:options.ordinary?{}:{sourcingConfirmed:true}};
  const meta={...input(),outboxId};
  const run=await load('../src/lib/internalChinaReceipt.ts','recordInternalChinaReceipt',{
    createHash,randomUUID:()=>receiptId,
    summarizeStoredReceiptReplay,validReceiptRequestId,
    CHINA_ORDER_EVENT_OPERATION_TYPE:'CHINA_ORDER_COMMITMENT_EVENT',
    loadChinaOrderLedger:async()=>({error:null,commitments:[commitment]}),
    normalizeChinaOrderCommitmentEvent:x=>x,
    loadInternalChinaPurchaseDraft:async()=>({exchangeRateKrwPerCny:230,lines:[{barcode:'BBA8-1',modelNo:meta.modelNumber,saleOption:meta.saleOption,unitPriceCny:10,quantity:5,freightGroupId:'',domesticChinaFreightCny:5}]}),
    loadInternalChinaDraftWithQuantityOverrides:async x=>x,
    koreanMonthLabel:x=>x,seoulCalendarMonth:x=>x.slice(0,7),
    sourcingMetadataFromCommitmentPayload:p=>p.sourcingConfirmed?meta:null,
    createSupabaseAdminHeaders:()=>({'content-type':'application/json'}),
    process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://fixture.test',SUPABASE_SECRET_KEY:'synthetic-only'}},
    retryInternalChinaReceiptFollowup:async id=>{calls.push('followup');assert.equal(id,receiptId);assert.equal(stored.length,1);if(options.failFollowup)throw Error('SOURCING_LAUNCH_NORMALIZED_PENDING');return {state:'VERIFIED'};},
    fetch:async(raw,init={})=>{
      assert.ok(raw.startsWith('https://fixture.test/rest/v1/commerce_operation_runs?'));
      if (!init.method || init.method === 'GET') {
        const url=new URL(raw);
        if (url.searchParams.has('result_snapshot->>receiptId')) {
          return Response.json(stored.map(row=>({result_snapshot:clone(row.result_snapshot)})));
        }
        return Response.json([]);
      }
      calls.push('store');
      if(options.failStore)return Response.json({}, {status:503});
      stored.push(...JSON.parse(init.body));
      return Response.json([{source_event_id:stored[0].source_event_id}]);
    },
  });
  return{run,calls,stored,input:{requestId:receiptId,draftId,cycleMonth:'2026-09',lines:[{barcode:'BBA8-1',quantity:2}]}};
}
test('actual receipt function never activates warehouse or launch after a failed durable write',async()=>{
  const b=await receiptBackend({failStore:true});await assert.rejects(b.run(b.input),/CHINA_RECEIPT_STORE_FAILED/);assert.deepEqual(b.calls,['store']);assert.equal(b.stored.length,0);
});
test('actual receipt function persists frozen source proof and cost before running followup',async()=>{
  const b=await receiptBackend();const result=await b.run(b.input);assert.deepEqual(b.calls,['store','followup']);
  assert.equal(result.productMasterSynced,true);assert.equal(result.launchMaterializedCount,1);
  assert.equal(b.stored[0].result_snapshot.sourcing.intakeId,intakeId);
  assert.equal(b.stored[0].result_snapshot.receiptCost.quantity,2);
  assert.equal(b.stored[0].result_snapshot.receiptCost.unitCostKrw,2530);
  assert.equal(b.stored[0].input_snapshot.status,'PARTIALLY_RECEIVED');
});
test('actual receipt function reports pending after artifact failure but does not reinsert receipt quantity',async()=>{
  const b=await receiptBackend({failFollowup:true});const result=await b.run(b.input);
  assert.equal(result.productMasterSynced,false);assert.equal(result.launchMaterializationError,'SOURCING_LAUNCH_NORMALIZED_PENDING');
  assert.equal(b.stored.length,1);assert.deepEqual(b.calls,['store','followup']);
});
test('actual receipt function rejects a sourced item without actual order evidence before any write',async()=>{
  const b=await receiptBackend({unordered:true});await assert.rejects(b.run(b.input),/ORDER_EVIDENCE_REQUIRED/);assert.deepEqual(b.calls,[]);
});
test('actual ordinary replenishment keeps original receipt accounting and has no launch creation',async()=>{
  const b=await receiptBackend({ordinary:true});const result=await b.run(b.input);assert.equal(result.launchMaterializedCount,0);assert.equal(b.stored[0].result_snapshot.sourcing,null);assert.equal(result.receivedNow,2);
});
test('actual receipt function rejects duplicate B-code lines before any writes',async()=>{
  const b=await receiptBackend();b.input.lines.push({...b.input.lines[0]});await assert.rejects(b.run(b.input),/DUPLICATE_BARCODE/);assert.deepEqual(b.calls,[]);
});


test('actual receipt function replays a lost-response retry without inserting quantity twice',async()=>{
  const b=await receiptBackend();
  const first=await b.run(b.input);
  const second=await b.run(b.input);
  assert.equal(first.receiptId,receiptId);assert.equal(second.receiptId,receiptId);
  assert.equal(first.receivedNow,2);assert.equal(second.receivedNow,2);
  assert.equal(b.stored.length,1);
  assert.deepEqual(b.calls,['store','followup','followup']);
});
