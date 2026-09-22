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
      readMonthlyLiveProduct:async()=>{log.push('read');return {rows:state.raw,optionLists:[{title:'옵션',values:['단품']}],optionIds:state.raw.map(row=>String(row.optId))};},
      writeMonthlyShoplingPrice:async(_,write)=>{log.push('write');if(state.writeError)throw new Error('MONTHLY_PRICE_WRITE_UNCERTAIN'); if(write.mallKey)state.observed.rows[0]={...state.observed.rows[0],...write.target};else state.raw=live(write.target.sellPrice);},
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
test('actual production action happy path: prepare -> durable intent -> writes -> readback -> one scoped transmission', async()=>{
  const h=harness();await h.call('prepare');assert.equal(h.item.state,'PREPARED');
  await h.call('write');assert.equal(h.item.write_index,1);
  assert.ok(h.log.indexOf('save:WRITING')<h.log.indexOf('WRITE_INTENT'));assert.ok(h.log.indexOf('WRITE_INTENT')<h.log.indexOf('write'));
  await h.call('write');assert.equal(h.item.state,'VERIFY_PENDING');
  await h.call('verify');assert.equal(h.item.state,'VERIFIED');
  const first=await h.call('resendClaim'),second=await h.call('resendClaim');
  assert.equal(first.duplicate,false);assert.equal(second.duplicate,true);assert.equal(first.transmission.token,second.transmission.token);
  await h.call('resendReport',{report:{token:first.transmission.token,fingerprint:h.item.plan.fingerprint,goodsKey,state:'SUCCEEDED',priceAndOption:true}});
  assert.equal(h.item.state,'TRANSMITTED');assert.equal(h.item.transmission.result,'RESULT_WINDOW_FINISHED_MARKET_CONFIRMATION_PENDING');
  assert.equal(h.log.filter(x=>x==='write').length,2);
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
test('exact preexisting target is counted but not rewritten',async()=>{
  const h=harness();await h.call('prepare');h.state.raw=live(h.item.plan.writes[0].target.sellPrice);await h.call('write');assert.equal(h.item.write_index,1);assert.equal(h.log.includes('WRITE_ALREADY_MATCHES'),true);assert.equal(h.log.includes('write'),false);
});
test('externally changed current price blocks even if it is higher',async()=>{
  const h=harness();await h.call('prepare');h.state.raw=live(99999);await h.call('write');assert.equal(h.item.state,'BLOCKED');assert.equal(h.item.error_code,'MONTHLY_PRICE_CURRENT_PRICE_CHANGED');assert.equal(h.log.includes('write'),false);
});
test('group changed after approval cannot write',async()=>{
  const h=harness();await h.call('prepare');h.state.group='소매1';await h.call('write');assert.equal(h.item.error_code,'MONTHLY_PRICE_GROUP_CHANGED');assert.equal(h.log.includes('write'),false);
});
test('ACK is insufficient for transmitting and malformed IDs are rejected',async()=>{
  const h=harness();await assert.rejects(()=>h.call('resendClaim'),/VERIFIED_REQUIRED/);await h.call('prepare');await h.call('write');await assert.rejects(()=>h.call('resendClaim'),/VERIFIED_REQUIRED/);
  await assert.rejects(()=>h.call('prepare',{itemId:'not-a-uuid'}),/ID_INVALID/);
});
test('refresh while WRITING can only recover by full positive readback',async()=>{
  const h=harness();await h.call('prepare');const p=h.item.plan;h.item.state='WRITING';h.state.raw=live(p.targets[0].target.sellPrice);h.state.observed=observation(p.targets[1].target.sellPrice);
  await h.call('verify');assert.equal(h.item.state,'VERIFIED');assert.equal(h.log.includes('write'),false);
});
test('wrong transmission token / goods key / missing option mode cannot mark finished',async()=>{
  const h=harness();await h.call('prepare');await h.call('write');await h.call('write');await h.call('verify');await h.call('resendClaim');
  const report={token:h.item.transmission.token,fingerprint:h.item.plan.fingerprint,goodsKey,state:'SUCCEEDED',priceAndOption:true};
  await assert.rejects(()=>h.call('resendReport',{report:{...report,token:'wrong'}}),/SCOPE_INVALID/);
  await assert.rejects(()=>h.call('resendReport',{report:{...report,goodsKey:'9876543'}}),/SCOPE_INVALID/);
  await h.call('resendReport',{report:{...report,priceAndOption:false}});assert.equal(h.item.state,'RESENDING');
  await h.call('resendReport',{report:{...report,state:'MISSING'}});assert.equal(h.item.state,'RESENDING');assert.equal(h.item.error_code,'MONTHLY_PRICE_MARKET_RESULT_REVIEW_REQUIRED');
});
test('two overlapping commands are mutually excluded at item lease boundary',async()=>{
  const h=harness();const first=h.call('prepare');await assert.rejects(()=>h.call('prepare'),/ITEM_BUSY/);await first;
});
test('write XML preserves retained columns, omits unchanged option payload and verifies ACK identity',()=>{
  const simple=loadModule('../src/lib/shopling/simpleXml.ts',{});
  const shop=loadModule('../src/lib/monthlyPriceShopling.ts',{'@/lib/shopling/shoplingReadClient':{},'@/lib/shopling/shoplingCurrentPriceResolver':{},'@/lib/shopling/shoplingTlsTransport':{},'@/lib/shopling/simpleXml':simple,'@/lib/monthlyPriceCore':core});
  const p=core.buildMonthlyPricePlan(candidate(),live(),observation()), w=p.writes[0];
  const xml=shop.buildMonthlyPriceWriteXml(goodsKey,w,{loginId:'TEST',companyId:'TEST',authKey:'TEST'});
  assert.match(xml,/<org_price>321<\/org_price>/);assert.match(xml,/<list_price>6543<\/list_price>/);assert.doesNotMatch(xml,/stock|quantity|option|margin_rate/);
  shop.assertMonthlyWriteAcknowledgement('<res><goodsRst><goods_key>1234567</goods_key><code>000</code></goodsRst></res>',goodsKey);
  assert.throws(()=>shop.assertMonthlyWriteAcknowledgement('<res><goodsRst><code>999</code></goodsRst></res>',goodsKey),/ACK_UNVERIFIED/);
  assert.throws(()=>shop.buildMonthlyPriceWriteXml(goodsKey,{...w,target:{...w.target,sellPrice:1}},{loginId:'TEST',companyId:'TEST',authKey:'TEST'}),/POLICY_VIOLATION/);
});

test('write XML carries verified option structure and nondecreasing option amounts when option price changes',()=>{
  const simple=loadModule('../src/lib/shopling/simpleXml.ts',{});
  const shop=loadModule('../src/lib/monthlyPriceShopling.ts',{'@/lib/shopling/shoplingReadClient':{},'@/lib/shopling/shoplingCurrentPriceResolver':{},'@/lib/shopling/shoplingTlsTransport':{},'@/lib/shopling/simpleXml':simple,'@/lib/monthlyPriceCore':core});
  const c=candidate(); c.options.push({...c.options[0],barcode:'ABC1-2',optionId:'12',currentCostKrw:1700,protectedCostKrw:1700});
  const rows=[...live(),{...live()[0],optId:'12',optAmt:'500'}];
  const p=core.buildMonthlyPricePlan(c,rows,observation(99000)),w=p.writes[0];
  const snapshot={rows,optionLists:[{title:'색상',values:['기본','고급']}],optionIds:['11','12']};
  const xml=shop.buildMonthlyPriceWriteXml(goodsKey,w,{loginId:'TEST',companyId:'TEST',authKey:'TEST'},snapshot);
  assert.match(xml,/<options>/);assert.match(xml,/<title><!\[CDATA\[색상\]\]><\/title>/);assert.match(xml,/<value><!\[CDATA\[기본,고급\]\]><\/value>/);assert.match(xml,/<optAmt>0,520<\/optAmt>/);
  assert.doesNotMatch(xml,/optQty|optStatus|optBarcode|stock|quantity/);
});
