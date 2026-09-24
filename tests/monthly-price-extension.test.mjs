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
    baselinePopupTabs:async()=>[],launchJob:async(s,j)=>{log.push(`launch:${j.mode}`);j.status='RUNNING';},pump:async()=>{log.push('legacy-pump');},startRun:async()=>{log.push('legacy');},
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
test('status reports success capability only when both PRICE and OPTION jobs exist',async()=>{
  const w=worker();await w.send('MONTHLY_PRICE_START');w.current.state='SUCCEEDED';
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


function batchToken(index) {
  const tail=String(index+1).padStart(12,'0');
  return `44444444-4444-4444-8444-${tail}`;
}
function batchItemId(index) {
  const tail=String(index+1).padStart(12,'0');
  return `22222222-2222-4222-8222-${tail}`;
}
function batchWorker(count=450,{soldOutIndexes=[],restoreIndexes=[]}={}) {
  const listeners=[],log=[],storage={}; let current=null;
  const run='11111111-1111-4111-8111-111111111111';
  const entries=Array.from({length:count},(_,index)=>({
    itemId:batchItemId(index),token:batchToken(index),fingerprint:'a'.repeat(64),newClaim:true,
  }));
  const serverItems=entries.map((entry,index)=>({
    id:entry.itemId,goodsKey:String(1000000+index),state:'RESENDING',
    transmission:{token:entry.token},
    plan:{fingerprint:entry.fingerprint,saleStatusTransition:soldOutIndexes.includes(index)?{before:'C',target:'B',restoreAfterTransmission:restoreIndexes.includes(index)}:null},
  }));
  const context={
    console,URL,Error,setTimeout,clearTimeout,
    chrome:{
      storage:{local:{get:async key=>({[key]:storage[key]}),set:async value=>Object.assign(storage,value)},onChanged:{addListener:()=>{}}},
      runtime:{onMessage:{addListener:f=>listeners.push(f)}},
      tabs:{query:async()=>[]},
    },
    loadState:async()=>current,
    saveState:async s=>{current=s;s.updatedAt=Date.now();return s;},
    baselinePopupTabs:async()=>[],
    buildBatches:rows=>{
      const batches=[];for(let i=0;i<rows.length;i+=200)batches.push({id:`b${batches.length+1}`,index:batches.length+1,goodsKeys:rows.slice(i,i+200).map(r=>String(r.goodsKey))});
      return batches;
    },
    addJobs:(s,b)=>{for(const mode of ['PRICE','OPTION'])s.jobs.push({id:`${mode}-${b.id}`,batchId:b.id,batchIndex:b.index,mode,goodsKeys:[...b.goodsKeys],status:'QUEUED',stage:'OPENING'});},
    pump:async()=>{},
    launchJob:async(s,j)=>{log.push(`launch:${j.mode}:${j.goodsKeys.length}`);j.status='RUNNING';j.stage='A21_BOOTSTRAP';await context.saveState(s);},
    fetch:async()=>({ok:true,json:async()=>({ok:true,run:{id:run},items:serverItems})}),
    globalThis:null,
  };
  context.globalThis=context;
  vm.createContext(context);vm.runInContext(file('background-monthly-batch-v054.js'),context);
  const sender={frameId:0,url:'https://commerce-os-ops-center.vercel.app/china-order-manager?month=2026-09'};
  const payload={month:'2026-09',runId:run,batchId:'55555555-5555-4555-8555-555555555555',entries};
  const send=(type,p=payload)=>new Promise(resolve=>listeners[0]({type,payload:p},sender,resolve));
  return {send,payload,entries,serverItems,log,context,get current(){return current;},set current(v){current=v;}};
}

test('monthly batch engine chunks GOODSKEYs at 200 and opens same-phase windows in parallel',async()=>{
  const w=batchWorker(450);
  const started=await w.send('MONTHLY_PRICE_START_BATCH');
  assert.equal(started.ok,true);
  const prices=w.current.jobs.filter(j=>j.mode==='PRICE');
  const options=w.current.jobs.filter(j=>j.mode==='OPTION');
  assert.deepEqual(Array.from(prices,j=>j.goodsKeys.length),[200,200,50]);
  assert.deepEqual(Array.from(options,j=>j.goodsKeys.length),[200,200,50]);
  assert.equal(prices.filter(j=>j.status==='RUNNING').length,3);
  assert.equal(options.filter(j=>j.status==='RUNNING').length,0);
  assert.deepEqual(w.log,['launch:PRICE:200','launch:PRICE:200','launch:PRICE:50']);
});

test('monthly batch engine caps parallel Shopling windows at four and never starts OPTION until every PRICE batch succeeds',async()=>{
  const w=batchWorker(1000);
  await w.send('MONTHLY_PRICE_START_BATCH');
  const prices=w.current.jobs.filter(j=>j.mode==='PRICE');
  const options=w.current.jobs.filter(j=>j.mode==='OPTION');
  assert.equal(prices.filter(j=>j.status==='RUNNING').length,4);
  assert.equal(prices.filter(j=>j.status==='QUEUED').length,1);
  assert.equal(options.filter(j=>j.status==='RUNNING').length,0);
  prices[0].status='SUCCEEDED';await w.context.pump();
  assert.equal(prices.filter(j=>j.status==='RUNNING').length,4);
  assert.equal(options.filter(j=>j.status==='RUNNING').length,0);
  for(const job of prices)job.status='SUCCEEDED';
  await w.context.pump();
  assert.equal(options.filter(j=>j.status==='RUNNING').length,4);
});

test('sold-out status phase completes before PRICE and failed PRICE prevents OPTION while activating rollback',async()=>{
  const w=batchWorker(2,{soldOutIndexes:[0,1]});
  await w.send('MONTHLY_PRICE_START_BATCH');
  const selling=w.current.jobs.filter(j=>j.mode==='STATUS_SELLING');
  const prices=w.current.jobs.filter(j=>j.mode==='PRICE');
  const options=w.current.jobs.filter(j=>j.mode==='OPTION');
  const rollback=w.current.jobs.filter(j=>j.mode==='STATUS_SOLD_OUT');
  assert.equal(selling[0].status,'RUNNING');assert.equal(prices[0].status,'QUEUED');assert.equal(options[0].status,'QUEUED');
  selling[0].status='SUCCEEDED';await w.context.pump();assert.equal(prices[0].status,'RUNNING');
  prices[0].status='FAILED';await w.context.pump();
  assert.equal(options[0].status,'STOPPED');
  assert.equal(rollback[0].status,'RUNNING');
});
