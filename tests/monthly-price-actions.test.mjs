import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/lib/monthlyPriceCore.ts';
import { loadModule } from './monthly-price-module.mjs';
import { candidate, live, observation, goodsKey, runId, itemId } from './monthly-price-fixtures.mjs';

function harness() {
  const item = { id:itemId,run_id:runId,goods_key:goodsKey,state:'QUEUED',candidate:candidate(),plan:null,write_index:0,claim_token:'lease',error_code:null,transmission:null };
  const run={id:runId,policy_version:core.MONTHLY_PRICE_POLICY,source_hash:'hash',source_snapshot:{evidenceVersion:'version'}};
  const log=[], state={raw:live(), observed:observation(),writeError:false,sourceError:false,failAudit:null,locked:false,group:'도매4'};
  const api=loadModule('../src/lib/monthlyPriceActions.ts',{
    '@/lib/monthlyPriceCore':core,
    '@/lib/monthlyPriceSource':{assertMonthlyEvidenceUnchanged:async()=>{log.push('source');if(state.sourceError) throw new Error('MONTHLY_PRICE_SOURCE_CHANGED');}},
    '@/lib/shopling/shoplingProductGroupRegistry':{loadShoplingProductGroupsByGoodsKey:async()=>new Map([[goodsKey,state.group]])},
    '@/lib/monthlyPriceShopling':{
      readMonthlyLiveProduct:async()=>{log.push('read');return state.raw;},
      ensureMonthlyShoplingSaleStatus:async(_,target)=>{
        log.push(`status:${target}`);
        const before=String(state.raw[0]?.sale_status||'');
        state.raw=state.raw.map(row=>({...row,sale_status:target}));
        return {before,after:target,changed:before!==target,rows:state.raw};
      },
      writeMonthlyShoplingPrice:async(_,write)=>{log.push('write');if(state.writeError)throw new Error('MONTHLY_PRICE_WRITE_UNCERTAIN'); if(write.mallKey)state.observed.rows[0]={...state.observed.rows[0],...write.target};else state.raw=live(write.target.sellPrice,write.options?.[0]?.targetAmount??0).map(row=>({...row,sale_status:state.raw[0]?.sale_status||'B'}));},
    },
    '@/lib/monthlyPriceStore':{
      withMonthlyPriceItem:async(id,rid,work)=>{if(state.locked)throw new Error('MONTHLY_PRICE_ITEM_BUSY');assert.equal(id,itemId);assert.equal(rid,runId);state.locked=true;try{return await work(item,run);}finally{log.push(`release:${item.state}`);state.locked=false;}},
      saveMonthlyPriceItem:async()=>{log.push(`save:${item.state}`);},
      auditMonthlyPrice:async(_,event)=>{log.push(event);if(state.failAudit===event)throw new Error('MONTHLY_PRICE_STORE_FAILED');},
    },
  });
  const call=(action,extra={})=>api.monthlyPriceItemAction({action,itemId,runId,observation:{...state.observed,observedAt:Date.now()},...extra});
  return {item,run,state,log,call};
}
test('actual production action happy path: prepare -> durable price+option intent -> writes -> readback -> scoped transmission', async()=>{
  const h=harness();await h.call('prepare');assert.equal(h.item.state,'PREPARED');
  await h.call('write');assert.equal(h.item.write_index,1);
  assert.ok(h.log.indexOf('save:WRITING')<h.log.indexOf('WRITE_INTENT'));assert.ok(h.log.indexOf('WRITE_INTENT')<h.log.indexOf('write'));
  await h.call('write');assert.equal(h.item.state,'VERIFY_PENDING');
  await h.call('verify');assert.equal(h.item.state,'VERIFIED');
  const first=await h.call('resendClaim'),second=await h.call('resendClaim');
  assert.equal(first.duplicate,false);assert.equal(second.duplicate,true);assert.equal(first.transmission.token,second.transmission.token);
  await h.call('resendReport',{report:{token:first.transmission.token,fingerprint:h.item.plan.fingerprint,goodsKey,state:'SUCCEEDED',priceOnly:false,priceAndOption:true,saleStatusActivated:true,saleStatusRestored:true}});
  assert.equal(h.item.state,'TRANSMITTED');assert.equal(h.item.transmission.result,'RESULT_WINDOW_FINISHED_MARKET_CONFIRMATION_PENDING');
  assert.equal(h.log.filter(x=>x==='write').length,2);
});
test('resend claim persists a validated batch id for refresh-safe grouped transmission',async()=>{
  const h=harness();await h.call('prepare');while(h.item.state==='PREPARED')await h.call('write');await h.call('verify');
  const batchId='55555555-5555-4555-8555-555555555555';
  const claimed=await h.call('resendClaim',{batchId});
  assert.equal(claimed.duplicate,false);
  assert.equal(h.item.transmission.batchId,batchId);
  const duplicate=await h.call('resendClaim',{batchId:'66666666-6666-4666-8666-666666666666'});
  assert.equal(duplicate.duplicate,true);
  assert.equal(h.item.transmission.batchId,batchId);
});

test('sold-out item switches Shopling master to selling before any price write',async()=>{
  const h=harness();h.state.raw=h.state.raw.map(row=>({...row,sale_status:'C'}));
  await h.call('prepare');
  assert.equal(h.item.plan.saleStatusTransition.target,'B');
  await h.call('write');
  assert.equal(h.log.includes('status:B'),true);
  assert.ok(h.log.indexOf('status:B')<h.log.indexOf('write'));
  assert.equal(h.state.raw[0].sale_status,'B');
});

test('legacy item without exact group auto-infers wholesale and can execute without confirmation',async()=>{
  const h=harness();h.state.group=null;h.item.candidate.productGroup='';
  await h.call('prepare');
  assert.equal(h.item.state,'PREPARED');assert.equal(h.item.plan.productGroup,'도매1');assert.equal(h.item.error_code,null);
  assert.equal(h.item.plan.targets.filter(x=>x.mallKey).length,1);
  await h.call('write');assert.equal(h.item.write_index,1);
});
test('retried old run can clear obsolete GROUP_REQUIRED candidate reason and use legacy family inference',async()=>{
  const h=harness();h.state.group=null;h.item.candidate.productGroup='';h.item.candidate.reason='MONTHLY_PRICE_GROUP_REQUIRED';
  await h.call('prepare');
  assert.equal(h.item.state,'PREPARED');assert.equal(h.item.plan.productGroup,'도매1');assert.equal(h.item.error_code,null);
  assert.equal(h.log.includes('write'),false);
});


test('legacy item with ambiguous family is silently held at current price instead of confirmation-blocked',async()=>{
  const h=harness();h.state.group=null;h.item.candidate.productGroup='';
  h.state.raw=live(3900);
  h.state.observed={...observation(3900),rows:[{...observation(3900).rows[0],mallKey:'SMALL_00999'}]};
  await h.call('prepare');
  assert.equal(h.item.state,'HELD');assert.equal(h.item.plan,null);assert.equal(h.item.error_code,null);
  assert.equal(h.log.includes('LEGACY_GROUP_UNRESOLVED_HELD'),true);assert.equal(h.log.includes('write'),false);
});

test('unknown-cost candidate and source drift do not write',async()=>{
  const h=harness();h.item.candidate.reason='MONTHLY_PRICE_CONFIRMED_COST_REQUIRED';await h.call('prepare');assert.equal(h.item.state,'BLOCKED');assert.equal(h.log.includes('write'),false);
  const b=harness();b.state.sourceError=true;await b.call('prepare');assert.equal(b.item.error_code,'MONTHLY_PRICE_SOURCE_CHANGED');assert.equal(b.log.includes('read'),false);
});
test('retry after lost write ACK is frozen, never repeats external write',async()=>{
  const h=harness();await h.call('prepare');h.state.writeError=true;await h.call('write');assert.equal(h.item.state,'UNCERTAIN');
  await h.call('write');await h.call('prepare');await h.call('verify');assert.equal(h.item.state,'UNCERTAIN');assert.equal(h.log.filter(x=>x==='write').length,1);
});
test('durable audit failure before API blocks the write',async()=>{
  const h=harness();await h.call('prepare');h.state.failAudit='WRITE_INTENT';await h.call('write');assert.equal(h.item.state,'UNCERTAIN');assert.equal(h.log.includes('write'),false);
});
test('exact preexisting base+option target is counted but not rewritten',async()=>{
  const h=harness();await h.call('prepare');const w=h.item.plan.writes[0];h.state.raw=live(w.target.sellPrice,w.options?.[0]?.targetAmount??0);await h.call('write');assert.equal(h.item.write_index,1);assert.equal(h.log.includes('WRITE_ALREADY_MATCHES'),true);assert.equal(h.log.includes('write'),false);
});
test('externally changed current base or option price blocks even if final price is higher',async()=>{
  const h=harness();await h.call('prepare');h.state.raw=live(99999);await h.call('write');assert.equal(h.item.state,'BLOCKED');assert.equal(h.item.error_code,'MONTHLY_PRICE_CURRENT_PRICE_CHANGED');assert.equal(h.log.includes('write'),false);
  const o=harness();await o.call('prepare');o.state.raw=live(1000,100);await o.call('write');assert.equal(o.item.error_code,'MONTHLY_PRICE_CURRENT_PRICE_CHANGED');assert.equal(o.log.includes('write'),false);
});
test('exact registry disappearing after prepare cannot silently reuse stale unrestricted plan',async()=>{
  const h=harness();
  await h.call('prepare');
  assert.equal(h.item.plan.groupResolution,'EXACT');
  h.state.group=null;
  await h.call('write');
  assert.equal(h.item.state,'BLOCKED');
  assert.equal(h.item.error_code,'MONTHLY_PRICE_GROUP_CHANGED');
  assert.equal(h.log.includes('write'),false);
});

test('group changed after approval cannot write',async()=>{
  const h=harness();await h.call('prepare');h.state.group='소매1';await h.call('write');assert.equal(h.item.error_code,'MONTHLY_PRICE_GROUP_CHANGED');assert.equal(h.log.includes('write'),false);
});
test('ACK is insufficient for transmitting and malformed IDs are rejected',async()=>{
  const h=harness();await assert.rejects(()=>h.call('resendClaim'),/VERIFIED_REQUIRED/);await h.call('prepare');await h.call('write');await assert.rejects(()=>h.call('resendClaim'),/VERIFIED_REQUIRED/);
  await assert.rejects(()=>h.call('prepare',{itemId:'not-a-uuid'}),/ID_INVALID/);
});
test('refresh while WRITING can only recover by full positive base+option readback',async()=>{
  const h=harness();await h.call('prepare');const p=h.item.plan,b=p.targets[0],m=p.targets[1];h.item.state='WRITING';h.state.raw=live(b.target.sellPrice,b.options?.[0]?.targetAmount??0);h.state.observed=observation(m.target.sellPrice);
  await h.call('verify');assert.equal(h.item.state,'VERIFIED');assert.equal(h.log.includes('write'),false);
});
test('sold-out transmission cannot finish without status activation evidence',async()=>{
  const h=harness();h.state.raw=h.state.raw.map(row=>({...row,sale_status:'C'}));
  await h.call('prepare');await h.call('write');while(h.item.state==='PREPARED')await h.call('write');
  await h.call('verify');await h.call('resendClaim');
  const report={token:h.item.transmission.token,fingerprint:h.item.plan.fingerprint,goodsKey,state:'SUCCEEDED',priceOnly:false,priceAndOption:true,saleStatusActivated:false,saleStatusRestored:true};
  await h.call('resendReport',{report});
  assert.equal(h.item.state,'RESENDING');
  assert.equal(h.item.error_code,'MONTHLY_PRICE_MARKET_RESULT_REVIEW_REQUIRED');
  assert.equal(h.log.includes('TRANSMISSION_UNCERTAIN'),true);
});

test('proven market failure rollback restores original sold-out Shopling master but remains review-required',async()=>{
  const h=harness();h.state.raw=h.state.raw.map(row=>({...row,sale_status:'C'}));
  await h.call('prepare');await h.call('write');while(h.item.state==='PREPARED')await h.call('write');
  await h.call('verify');await h.call('resendClaim');
  const report={token:h.item.transmission.token,fingerprint:h.item.plan.fingerprint,goodsKey,state:'PARTIAL_FAILURE',priceOnly:false,priceAndOption:false,saleStatusActivated:true,saleStatusRestored:false,saleStatusRolledBack:true};
  await h.call('resendReport',{report});
  assert.equal(h.item.state,'RESENDING');
  assert.equal(h.item.error_code,'MONTHLY_PRICE_MARKET_RESULT_REVIEW_REQUIRED');
  assert.equal(h.log.includes('status:C'),true);
  assert.equal(h.state.raw[0].sale_status,'C');
  assert.equal(h.log.includes('SALE_STATUS_FAILURE_ROLLBACK'),true);
});

test('third-stage A21 failure is terminal relist-required and is never marked transmitted',async()=>{
  const h=harness();await h.call('prepare');await h.call('write');await h.call('write');await h.call('verify');await h.call('resendClaim');
  const report={token:h.item.transmission.token,fingerprint:h.item.plan.fingerprint,goodsKey,state:'RELIST_REQUIRED',priceOnly:false,priceAndOption:false,relistRequired:true,priceOutcome:'RELIST_REQUIRED',optionOutcome:'MISSING',saleStatusActivated:true,saleStatusRestored:true,saleStatusRolledBack:false};
  await h.call('resendReport',{report});
  assert.equal(h.item.state,'RESENDING');
  assert.equal(h.item.error_code,'MONTHLY_PRICE_RELIST_REQUIRED');
  assert.equal(h.log.includes('MARKET_RELIST_REQUIRED'),true);
  assert.equal(h.item.transmission.finishedAt,undefined);
});

test('wrong transmission token / goods key / missing option transmission cannot mark finished',async()=>{
  const h=harness();await h.call('prepare');await h.call('write');await h.call('write');await h.call('verify');await h.call('resendClaim');
  const report={token:h.item.transmission.token,fingerprint:h.item.plan.fingerprint,goodsKey,state:'SUCCEEDED',priceOnly:false,priceAndOption:true};
  await assert.rejects(()=>h.call('resendReport',{report:{...report,token:'wrong'}}),/SCOPE_INVALID/);
  await assert.rejects(()=>h.call('resendReport',{report:{...report,goodsKey:'9876543'}}),/SCOPE_INVALID/);
  await h.call('resendReport',{report:{...report,priceAndOption:false}});assert.equal(h.item.state,'RESENDING');
  await h.call('resendReport',{report:{...report,state:'MISSING'}});assert.equal(h.item.state,'RESENDING');assert.equal(h.item.error_code,'MONTHLY_PRICE_MARKET_RESULT_REVIEW_REQUIRED');
});
test('two overlapping commands are mutually excluded at item lease boundary',async()=>{
  const h=harness();const first=h.call('prepare');await assert.rejects(()=>h.call('prepare'),/ITEM_BUSY/);await first;
});
test('base-only write preserves option structure entirely, and option writes never include inventory fields',()=>{
  const simple=loadModule('../src/lib/shopling/simpleXml.ts',{});
  const shop=loadModule('../src/lib/monthlyPriceShopling.ts',{'@/lib/shopling/shoplingReadClient':{},'@/lib/shopling/shoplingCurrentPriceResolver':{},'@/lib/shopling/shoplingTlsTransport':{},'@/lib/shopling/simpleXml':simple,'@/lib/monthlyPriceCore':core});
  const p=core.buildMonthlyPricePlan(candidate(),live(),observation()), w=p.writes[0];
  const xml=shop.buildMonthlyPriceWriteXml(goodsKey,w,{loginId:'TEST',companyId:'TEST',authKey:'TEST'});
  assert.match(xml,/<org_price>321<\/org_price>/);assert.match(xml,/<list_price>6543<\/list_price>/);
  assert.doesNotMatch(xml,/<options>/);assert.doesNotMatch(xml,/optQty|optVrtlQty|stock|quantity|margin_rate/);
  assert.doesNotMatch(xml,/optQty|optVrtlQty|stock|quantity|margin_rate/);
  const mall= p.writes.find(x=>x.mallKey); const mallXml=shop.buildMonthlyPriceWriteXml(goodsKey,mall,{loginId:'TEST',companyId:'TEST',authKey:'TEST'});assert.doesNotMatch(mallXml,/<options>/);
  shop.assertMonthlyWriteAcknowledgement('<res><goodsRst><goods_key>1234567</goods_key><code>000</code></goodsRst></res>',goodsKey);
  assert.throws(()=>shop.assertMonthlyWriteAcknowledgement('<res><goodsRst><code>999</code></goodsRst></res>',goodsKey),/ACK_UNVERIFIED/);
  assert.throws(()=>shop.buildMonthlyPriceWriteXml(goodsKey,{...w,target:{...w.target,sellPrice:1}},{loginId:'TEST',companyId:'TEST',authKey:'TEST'}),/POLICY_VIOLATION/);
});
test('zero mall current price and sale-status-only XML are explicit safe writes',()=>{
  const simple=loadModule('../src/lib/shopling/simpleXml.ts',{});
  const shop=loadModule('../src/lib/monthlyPriceShopling.ts',{'@/lib/shopling/shoplingReadClient':{},'@/lib/shopling/shoplingCurrentPriceResolver':{},'@/lib/shopling/shoplingTlsTransport':{},'@/lib/shopling/simpleXml':simple,'@/lib/monthlyPriceCore':core});
  const p=core.buildMonthlyPricePlan(candidate(),live(),observation(0));
  const mall=p.writes.find(x=>x.kind==='MALL_PRICE');
  assert.equal(mall.before.sellPrice,0);assert.ok(mall.target.sellPrice>0);
  const mallXml=shop.buildMonthlyPriceWriteXml(goodsKey,mall,{loginId:'TEST',companyId:'TEST',authKey:'TEST'});
  assert.match(mallXml,new RegExp(`<sale_price>${mall.target.sellPrice}</sale_price>`));
  const statusXml=shop.buildMonthlySaleStatusWriteXml(goodsKey,'B',{loginId:'TEST',companyId:'TEST',authKey:'TEST'});
  assert.match(statusXml,/<sale_status>B<\/sale_status>/);
  assert.doesNotMatch(statusXml,/sale_price|org_price|list_price|<options>|optQty|stock|quantity/);
});

test('option-only Shopling write is allowed when final option price rises and base is unchanged',()=>{
  const simple=loadModule('../src/lib/shopling/simpleXml.ts',{});
  const shop=loadModule('../src/lib/monthlyPriceShopling.ts',{'@/lib/shopling/shoplingReadClient':{},'@/lib/shopling/shoplingCurrentPriceResolver':{},'@/lib/shopling/shoplingTlsTransport':{},'@/lib/shopling/simpleXml':simple,'@/lib/monthlyPriceCore':core});
  const c=candidate();c.options.push({barcode:'ABC1-2',optionId:'12',unitsPerOrder:1,currentCostKrw:2500,protectedCostKrw:2500});
  const rows=[{...live(3900,0)[0],optionName:'색상:화이트'},{...live(3900,1000)[0],optId:'12',optPtnOptCd:'ABC1-2',optBarcode:'123456789013',optionName:'색상:블랙'}];
  const plan=core.buildMonthlyPricePlan(c,rows,observation(99999)),w=plan.writes[0];
  assert.equal(w.target.sellPrice,w.before.sellPrice);assert.ok(w.options.some(x=>x.targetAmount!==x.beforeAmount));
  const xml=shop.buildMonthlyPriceWriteXml(goodsKey,w,{loginId:'TEST',companyId:'TEST',authKey:'TEST'});assert.match(xml,/<optAmt><!\[CDATA\[0,2600\]\]><\/optAmt>/);
});
