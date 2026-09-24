import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import { runId, itemId, goodsKey } from './monthly-price-fixtures.mjs';
const file=(name)=>readFileSync(new URL(`../public/shopling-a21-price-option-resend/${name}`,import.meta.url),'utf8');
const token='44444444-4444-4444-8444-444444444444',fingerprint='a'.repeat(64);
function worker() {
  const storage={},log=[],listeners=[];
  let current=null,shoplingTabs=[{id:12,url:'https://a.shopling.co.kr/main.phtml'}];
  const item={id:itemId,goodsKey,state:'RESENDING',plan:{fingerprint,targets:[{mallKey:'SMALL_00069'}],optionChangeCount:1,saleStatusTransition:null},transmission:{token}};
  const context={console,URL,Error,setTimeout,clearTimeout,importScripts:()=>{},
    chrome:{storage:{local:{get:async key=>({[key]:storage[key]}),set:async value=>Object.assign(storage,value)},onChanged:{addListener:()=>{}}},runtime:{onMessage:{addListener:f=>listeners.push(f)}},tabs:{query:async()=>shoplingTabs},scripting:{}},
    loadState:async()=>current,saveState:async s=>{log.push('persist');current=s;},publicState:s=>s,
    buildBatches:rows=>[{id:'batch',goodsKeys:rows.map(r=>r.goodsKey)}],addJobs:(s,b)=>s.jobs.push(
      {id:'price',mode:'PRICE',goodsKeys:b.goodsKeys,status:'QUEUED',stage:'OPENING'},
      {id:'option',mode:'OPTION',goodsKeys:b.goodsKeys,status:'QUEUED',stage:'OPENING'}
    ),
    baselinePopupTabs:async()=>[],launchJob:async(s,j)=>{log.push(`launch:${j.mode}`);j.status='RUNNING';},finalizeOrPump:async()=>{},pump:async()=>{log.push('legacy-pump');},startRun:async()=>{log.push('legacy');},
    splitBatch:async()=>{},failJob:async()=>{},closeManaged:async()=>{},
    fetch:async url=>{log.push(url);return {ok:true,json:async()=>({ok:true,run:{id:runId},items:[item]})};},
  };
  vm.createContext(context);vm.runInContext(file('background-monthly-price.js'),context);
  const payload={month:'2026-09',runId,itemId,token,fingerprint,newClaim:true};
  const sender={frameId:0,url:'https://commerce-os-ops-center.vercel.app/china-order-manager?month=2026-09'};
  const send=(type,p=payload,s=sender)=>new Promise(resolve=>listeners[0]({type,payload:p},s,resolve));
  return {send,payload,sender,log,item,storage,context,get current(){return current;},set current(v){current=v;},get shoplingTabs(){return shoplingTabs;},set shoplingTabs(v){shoplingTabs=v;}};
}
test('extension rejects other-origin and subframe commands',async()=>{
  const w=worker();for(const sender of [{frameId:0,url:'https://evil.invalid/china-order-manager'}, {...w.sender,frameId:9}]) {
    assert.equal((await w.send('MONTHLY_PRICE_START',w.payload,sender)).error,'MONTHLY_PRICE_SENDER_REJECTED');
  }assert.equal(w.log.length,0);
});
test('extension one product scope uses server-verified immutable run, persists token before pump, and schedules PRICE then OPTION',async()=>{
  const w=worker(),r=await w.send('MONTHLY_PRICE_START');assert.equal(r.ok,true);assert.equal(w.current.jobs.length,2);
  assert.deepEqual(Array.from(w.current.jobs,x=>x.mode),['PRICE','OPTION']);assert.ok(w.current.jobs.every(x=>x.monthlyScope));
  assert.equal(w.current.jobs[0].goodsKeys.join(','),goodsKey);assert.ok(w.log.find(x=>x.includes('runId='+runId)));assert.ok(w.log.indexOf('persist')<w.log.findIndex(x=>x.startsWith('launch:')));assert.equal(w.log.includes('legacy'),false);
  const before=w.current.jobs.length;w.context.addJobs(w.current,{goodsKeys:[goodsKey]});assert.equal(w.current.jobs.length,before+2);assert.ok(w.current.jobs.slice(before).every(x=>x.monthlyScope));
});
test('monthly start falls back to Shopling main when no source tab is open',async()=>{
  const w=worker();w.shoplingTabs=[];const r=await w.send('MONTHLY_PRICE_START');
  assert.equal(r.ok,true);assert.equal(w.current.sourceUrl,'https://a.shopling.co.kr/main.phtml');assert.equal(w.log.some(x=>x.startsWith('launch:')),true);
});
test('status reports success capability only when both PRICE and OPTION jobs succeeded',async()=>{
  const w=worker();await w.send('MONTHLY_PRICE_START');
  for(const job of w.current.jobs)job.status='SUCCEEDED';
  w.current.state='SUCCEEDED';
  const status=await w.send('MONTHLY_PRICE_STATUS',{token,fingerprint,goodsKey});assert.equal(status.ok,true);assert.equal(status.report.priceOnly,false);assert.equal(status.report.priceAndOption,true);
});
test('sold-out monthly transmission queues STATUS_SELLING -> PRICE -> OPTION and optional restore last',async()=>{
  const w=worker();
  w.item.plan.saleStatusTransition={before:'C',target:'B',restoreAfterTransmission:false};
  let r=await w.send('MONTHLY_PRICE_START');
  assert.equal(r.ok,true);
  assert.deepEqual(Array.from(w.current.jobs,x=>x.mode),['STATUS_SELLING','PRICE','OPTION','STATUS_SOLD_OUT']);
  assert.equal(w.current.jobs.find(x=>x.mode==='STATUS_SOLD_OUT').status,'DORMANT');
  let status=await w.send('MONTHLY_PRICE_STATUS',{token,fingerprint,goodsKey});
  assert.equal(status.report.saleStatusActivated,false);
  assert.equal(status.report.saleStatusRestored,true);
  assert.equal(status.report.saleStatusRolledBack,false);

  const w2=worker();
  w2.item.plan.saleStatusTransition={before:'C',target:'B',restoreAfterTransmission:true};
  r=await w2.send('MONTHLY_PRICE_START');
  assert.equal(r.ok,true);
  assert.deepEqual(Array.from(w2.current.jobs,x=>x.mode),['STATUS_SELLING','PRICE','OPTION','STATUS_SOLD_OUT']);
  assert.equal(w2.current.jobs.find(x=>x.mode==='STATUS_SOLD_OUT').status,'QUEUED');
});

test('monthly extension never starts OPTION before PRICE and rolls back sold-out status if PRICE fails',async()=>{
  const w=worker();
  w.item.plan.saleStatusTransition={before:'C',target:'B',restoreAfterTransmission:false};
  await w.send('MONTHLY_PRICE_START');
  assert.deepEqual(w.log.filter(x=>x.startsWith('launch:')),['launch:STATUS_SELLING']);
  const statusJob=w.current.jobs.find(x=>x.mode==='STATUS_SELLING');
  statusJob.status='SUCCEEDED';
  const price=w.current.jobs.find(x=>x.mode==='PRICE');
  const option=w.current.jobs.find(x=>x.mode==='OPTION');
  const rollback=w.current.jobs.find(x=>x.mode==='STATUS_SOLD_OUT');
  await w.context.pump();
  assert.equal(price.status,'RUNNING');assert.equal(option.status,'QUEUED');assert.equal(rollback.status,'DORMANT');
  price.status='FAILED';price.error='fixture';
  await w.context.pump();
  assert.equal(option.status,'STOPPED');
  assert.equal(rollback.status,'RUNNING');
  assert.ok(w.log.includes('launch:STATUS_SOLD_OUT'));
  rollback.status='SUCCEEDED';
  await w.context.pump();
  assert.equal(w.current.state,'PARTIAL_FAILURE');
  const report=await w.send('MONTHLY_PRICE_STATUS',{token,fingerprint,goodsKey});
  assert.equal(report.report.saleStatusRolledBack,true);
});

test('duplicate and refresh preserve token and never launch the first job twice',async()=>{
  const w=worker();await w.send('MONTHLY_PRICE_START');await w.send('MONTHLY_PRICE_START',{...w.payload,newClaim:false});assert.equal(w.log.filter(x=>x==='launch:PRICE').length,1);
});
test('missing local transmission history is not interpreted as safe-to-resend',async()=>{
  const w=worker(),r=await w.send('MONTHLY_PRICE_START',{...w.payload,newClaim:false});assert.equal(r.ok,false);assert.equal(r.error,'MONTHLY_PRICE_TRANSMISSION_HISTORY_MISSING');assert.equal(w.log.includes('pump'),false);
});
test('tampered goods key or fingerprint not accepted from Ops page',async()=>{
  const w=worker();w.item.plan.fingerprint='b'.repeat(64);const r=await w.send('MONTHLY_PRICE_START');assert.equal(r.error,'MONTHLY_PRICE_SERVER_SCOPE_NOT_VERIFIED');assert.equal(w.log.includes('pump'),false);
});
test('late server-unverified token cannot fall back to global latest proposal',async()=>{
  const w=worker();w.item.state='VERIFIED';const r=await w.send('MONTHLY_PRICE_START');assert.equal(r.error,'MONTHLY_PRICE_SERVER_SCOPE_NOT_VERIFIED');assert.equal(w.log.includes('legacy'),false);
});
test('extension update retains local journal; old listener ignores new message namespace',()=>{
  const source=file('background-v020.js');assert.match(source,/details\.reason === "install"/);assert.match(source,/startsWith\("A21_"\)/);
});
test('monthly result watcher refuses unrelated Shopling tabs and has refresh wake without resend',()=>{
  assert.match(file('background-v041.js'),/if \(job\?\.monthlyScope\) return false/);assert.match(file('background-v044.js'),/if \(job\?\.monthlyScope\) return false/);
  assert.match(file('background-v041.js'),/commerceOsWakeA21MonthlyResult/);assert.match(file('background-monthly-price.js'),/commerceOsWakeA21MonthlyResult/);
});
test('DOM parser does not guess price columns by arbitrary position',()=>{
  const source=file('monthly-price-dom.js');assert.match(source,/input_name/);assert.match(source,/header/);assert.doesNotMatch(source,/source: ["']position/);
});


function batchWorker(count=450) {
  const storage={},log=[],listeners=[];
  let current=null;
  const batchId='55555555-5555-4555-8555-555555555555';
  const makeUuid=(n)=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`;
  const items=Array.from({length:count},(_,i)=>{
    const id=makeUuid(i+1),token=`bbbbbbbb-bbbb-4bbb-8bbb-${String(i+1).padStart(12,'0')}`,goodsKey=String(2000000+i);
    return {id,goodsKey,state:'RESENDING',plan:{fingerprint:'c'.repeat(64),targets:[{mallKey:'SMALL_00069'}],optionChangeCount:1,saleStatusTransition:null},transmission:{token,batchId}};
  });
  const context={console,URL,Error,setTimeout,clearTimeout,importScripts:()=>{},
    chrome:{storage:{local:{get:async key=>({[key]:storage[key]}),set:async value=>Object.assign(storage,value)},onChanged:{addListener:()=>{}}},runtime:{onMessage:{addListener:f=>listeners.push(f)}},tabs:{query:async()=>[]},scripting:{}},
    loadState:async()=>current,saveState:async s=>{current=s;},publicState:s=>s,
    buildBatches:rows=>{const out=[];for(let i=0;i<rows.length;i+=200)out.push({id:`batch-${i}`,index:out.length+1,goodsKeys:rows.slice(i,i+200).map(r=>String(r.goodsKey))});return out;},
    addJobs:(s,b)=>s.jobs.push({id:`p-${b.id}`,batchId:b.id,batchIndex:b.index,mode:'PRICE',goodsKeys:b.goodsKeys,status:'QUEUED',stage:'OPENING'},{id:`o-${b.id}`,batchId:b.id,batchIndex:b.index,mode:'OPTION',goodsKeys:b.goodsKeys,status:'QUEUED',stage:'OPENING'}),
    baselinePopupTabs:async()=>[],launchJob:async(_s,j)=>{log.push(`launch:${j.mode}:${j.goodsKeys.length}`);j.status='RUNNING';},finalizeOrPump:async()=>{},pump:async()=>{},startRun:async()=>{},
    splitBatch:async()=>{},failJob:async()=>{},closeManaged:async()=>{},
    fetch:async()=>({ok:true,json:async()=>({ok:true,run:{id:runId},items})}),
  };
  vm.createContext(context);vm.runInContext(file('background-monthly-price.js'),context);
  const payload={month:'2026-09',runId,batchId,newClaim:true,items:items.map(row=>({itemId:row.id,token:row.transmission.token,fingerprint:row.plan.fingerprint}))};
  const sender={frameId:0,url:'https://commerce-os-ops-center.vercel.app/china-order-manager?month=2026-09'};
  const send=(type,p=payload)=>new Promise(resolve=>listeners[0]({type,payload:p},sender,resolve));
  return {send,payload,batchId,items,log,context,get current(){return current;}};
}

test('v0.5.6 batch mode chunks GOODSKEY by 200, opens same-phase windows in parallel, and gates OPTION until every PRICE batch succeeds',async()=>{
  const w=batchWorker(450);
  const started=await w.send('MONTHLY_PRICE_BATCH_START');
  assert.equal(started.ok,true);
  assert.equal(w.current.jobs.filter(x=>x.mode==='PRICE').length,3);
  assert.equal(w.current.jobs.filter(x=>x.mode==='OPTION').length,3);
  assert.deepEqual(Array.from(w.current.jobs.filter(x=>x.mode==='PRICE'),x=>x.goodsKeys.length),[200,200,50]);
  assert.deepEqual(w.log,['launch:PRICE:200','launch:PRICE:200','launch:PRICE:50']);
  assert.equal(w.current.jobs.some(x=>x.mode==='OPTION'&&x.status==='RUNNING'),false);
  for(const job of w.current.jobs.filter(x=>x.mode==='PRICE'))job.status='SUCCEEDED';
  await w.context.pump();
  assert.deepEqual(w.log.slice(3),['launch:OPTION:200','launch:OPTION:200','launch:OPTION:50']);
  assert.equal(w.current.jobs.filter(x=>x.mode==='OPTION'&&x.status==='RUNNING').length,3);
});

test('v0.5.6 option-phase failure activates sold-out rollback instead of terminalizing early',async()=>{
  const w=batchWorker(2);
  w.items[0].plan.saleStatusTransition={before:'C',target:'B',restoreAfterTransmission:false};
  w.payload.items=w.items.map(row=>({itemId:row.id,token:row.transmission.token,fingerprint:row.plan.fingerprint}));
  await w.send('MONTHLY_PRICE_BATCH_START');
  const selling=w.current.jobs.filter(x=>x.mode==='STATUS_SELLING');
  assert.equal(selling.length,1);
  selling.forEach(x=>x.status='SUCCEEDED');
  await w.context.pump();
  w.current.jobs.filter(x=>x.mode==='PRICE').forEach(x=>x.status='SUCCEEDED');
  await w.context.pump();
  const options=w.current.jobs.filter(x=>x.mode==='OPTION');
  assert.equal(options.length,1);
  options[0].status='FAILED';
  await w.context.finalizeOrPump();
  const rollback=w.current.jobs.find(x=>x.mode==='STATUS_SOLD_OUT'&&x.monthlyFailureRollback===true);
  assert.equal(rollback.status,'RUNNING');
  assert.ok(w.log.some(x=>x.startsWith('launch:STATUS_SOLD_OUT:')));
  let status=await w.send('MONTHLY_PRICE_BATCH_STATUS',{batchId:w.batchId});
  assert.equal(status.report.state,'RUNNING');
  rollback.status='SUCCEEDED';
  await w.context.finalizeOrPump();
  status=await w.send('MONTHLY_PRICE_BATCH_STATUS',{batchId:w.batchId});
  assert.equal(status.report.state,'PARTIAL_FAILURE');
  assert.equal(status.report.items[0].saleStatusRolledBack,true);
});

test('v0.5.6 batch mode caps concurrent Shopling windows at four for a phase',async()=>{
  const w=batchWorker(1000);
  await w.send('MONTHLY_PRICE_BATCH_START');
  assert.equal(w.current.jobs.filter(x=>x.mode==='PRICE'&&x.status==='RUNNING').length,4);
  assert.equal(w.current.jobs.filter(x=>x.mode==='PRICE'&&x.status==='QUEUED').length,1);
  assert.equal(w.current.jobs.some(x=>x.mode==='OPTION'&&x.status==='RUNNING'),false);
});
