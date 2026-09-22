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
  const item={id:itemId,goodsKey,state:'RESENDING',plan:{fingerprint,targets:[{mallKey:'SMALL_00069'}],optionChangeCount:1},transmission:{token}};
  const context={console,URL,Error,setTimeout,clearTimeout,importScripts:()=>{},
    chrome:{storage:{local:{get:async key=>({[key]:storage[key]}),set:async value=>Object.assign(storage,value)},onChanged:{addListener:()=>{}}},runtime:{onMessage:{addListener:f=>listeners.push(f)}},tabs:{query:async()=>shoplingTabs},scripting:{}},
    loadState:async()=>current,saveState:async s=>{log.push('persist');current=s;},publicState:s=>s,
    buildBatches:rows=>[{id:'batch',goodsKeys:rows.map(r=>r.goodsKey)}],addJobs:(s,b)=>s.jobs.push({mode:'PRICE',goodsKeys:b.goodsKeys},{mode:'OPTION',goodsKeys:b.goodsKeys}),
    baselinePopupTabs:async()=>[],pump:async()=>{log.push('pump');},startRun:async()=>{log.push('legacy');},
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
  assert.equal(w.current.jobs[0].goodsKeys.join(','),goodsKey);assert.ok(w.log.find(x=>x.includes('runId='+runId)));assert.ok(w.log.indexOf('persist')<w.log.indexOf('pump'));assert.equal(w.log.includes('legacy'),false);
  const before=w.current.jobs.length;w.context.addJobs(w.current,{goodsKeys:[goodsKey]});assert.equal(w.current.jobs.length,before+2);assert.ok(w.current.jobs.slice(before).every(x=>x.monthlyScope));
});
test('monthly start falls back to Shopling main when no source tab is open',async()=>{
  const w=worker();w.shoplingTabs=[];const r=await w.send('MONTHLY_PRICE_START');
  assert.equal(r.ok,true);assert.equal(w.current.sourceUrl,'https://a.shopling.co.kr/main.phtml');assert.equal(w.log.includes('pump'),true);
});
test('status reports success capability only when both PRICE and OPTION jobs exist',async()=>{
  const w=worker();await w.send('MONTHLY_PRICE_START');w.current.state='SUCCEEDED';
  const status=await w.send('MONTHLY_PRICE_STATUS',{token,fingerprint,goodsKey});assert.equal(status.ok,true);assert.equal(status.report.priceOnly,false);assert.equal(status.report.priceAndOption,true);
});
test('duplicate and refresh preserve token and never pump twice',async()=>{
  const w=worker();await w.send('MONTHLY_PRICE_START');await w.send('MONTHLY_PRICE_START',{...w.payload,newClaim:false});assert.equal(w.log.filter(x=>x==='pump').length,1);
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
