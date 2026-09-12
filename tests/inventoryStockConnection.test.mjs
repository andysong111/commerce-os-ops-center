import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createInventoryReadClient, startInventoryPolling, INVENTORY_QUEUE_PATH as Q, INVENTORY_REFRESH_PATH as R } from '../src/lib/inventoryStockConnection.ts';
import { createInventoryReadGuard } from '../src/lib/inventoryStockReadGuard.ts';
const ok = () => Response.json({ok:true,report:{state:'READY',rows:[]},jobs:[]});
test('passive reads share one request but completed jobs are not cached', async () => {
 let calls=0, release;
 const client=createInventoryReadClient({fetcher:async () => { calls++; await new Promise(r=>release=r); return ok(); }});
 const a=client.read(Q), b=client.read(Q); assert.equal(calls,1); release(); await Promise.all([a,b]);
 const c=client.read(Q); assert.equal(calls,2); release(); await c;
});
test('execution reads never reuse a pre-existing passive result', async () => {
 let calls=0, release;
 const client=createInventoryReadClient({fetcher:async () => { calls++; if(calls===1)await new Promise(r=>release=r); return ok(); }});
 const a=client.read(Q), b=client.read(Q,true); assert.equal(calls,1); release(); await Promise.all([a,b]);assert.equal(calls,2);
});
test('cooldown blocks repeated clicks across both paths and recovers', async () => {
 let now=0,calls=0;
 const client=createInventoryReadClient({now:()=>now,fetcher:async()=>{calls++;return calls===1?Response.json({ok:false,code:'TIMEOUT',message:'timeout'},{status:503}):ok();}});
 await assert.rejects(client.read(Q),/TIMEOUT/); await assert.rejects(client.read(R));assert.equal(calls,1);
 now=30001;await client.read(Q); assert.equal(calls,2);await client.read(Q);assert.equal(calls,3);
});
test('HTML and BLOCKED reports never become successful empty inventory', async () => {
 const client=createInventoryReadClient({fetcher:async()=>new Response('<html>Bad Gateway</html>',{status:502})});
 await assert.rejects(client.read(Q),/HTTP_502/);
 const blocked=createInventoryReadClient({fetcher:async()=>Response.json({ok:true,report:{state:'BLOCKED',rows:[]}})});
 await assert.rejects(blocked.read(Q));
});
test('polling never overlaps, backs off, and stops when hidden or unmounted', async()=>{
 let calls=0,visible=false,release;const delays=[];
 const poll=startInventoryPolling({task:async()=>{calls++;await new Promise(r=>release=r);throw new Error('offline');},active:()=>visible,onError:()=>{},schedule:(_fn,ms)=>{delays.push(ms);return 1;},cancel:()=>{}});
 await poll.run();assert.equal(calls,0);visible=true;const running=poll.run();void poll.run();assert.equal(calls,1);release();await running;assert.equal(delays.at(-1),30000);
 const second=poll.run();release();await second;assert.equal(delays.at(-1),60000);
 poll.stop();await poll.run();assert.equal(calls,2);
});
test('timeouts return traceable 503 and avoid work until cooldown expires',async()=>{
 let now=0,calls=0;const logs=[];const guard=createInventoryReadGuard({now:()=>now,log:x=>logs.push(x)});
 const work=async()=>{calls++;throw Error('INVENTORY_STOCK_TAIL_LATEST_VIEW_READ_FAILED:Supabase REST timeout after 5000ms');};
 const a=await guard('queue',work);assert.equal(a.status,503);const body=await a.json();assert.equal(body.code,'INVENTORY_STOCK_READ_TIMEOUT');assert.ok(body.requestId);assert.deepEqual(body.jobs,[]);
 await guard('queue',work);assert.equal(calls,1);now=30001;await guard('queue',work);assert.equal(calls,2);assert.equal(logs.at(-1).retryAfterSeconds,60);
 now=90002;await guard('queue',async()=>Response.json({ok:true}));await guard('queue',async()=>{calls++;return Response.json({ok:true});});assert.equal(calls,3);
});
test('blocked responses remove jobs and successful reports are never cached',async()=>{
 const guard=createInventoryReadGuard({log:()=>{}});
 const response=await guard('overview',async()=>Response.json({ok:false,report:{state:'BLOCKED',message:'missing evidence'},jobs:[{jobId:'unsafe'}]},{status:503}));
 const data=await response.json();assert.deepEqual(data.jobs,[]);assert.equal(data.report.state,'BLOCKED');assert.equal(data.message,'missing evidence');
 let count=0;const work=async()=>Response.json({version:++count});await guard('queue',work);assert.equal((await (await guard('queue',work)).json()).version,2);
});
test('both panels use bounded visible-only polling and explicit actions stay fresh',()=>{
 for(const file of ['InventoryStockOverviewPanel','StockSyncOperationalQueuePanel']){
  const source=readFileSync(`src/components/china-order-manager/${file}.tsx`,'utf8');
  assert.match(source,/startInventoryPolling/);assert.doesNotMatch(source,/setInterval/);
  assert.match(source,/visibilityState/);assert.match(source,/navigator\.onLine/);assert.match(source,/polling\.stop/);
 }
 const queue=readFileSync('src/components/china-order-manager/StockSyncOperationalQueuePanel.tsx','utf8');
 assert.match(queue,/fresh = true/);assert.match(queue,/loadQueue\(false\)/);assert.match(queue,/details\.open/);
 assert.match(queue,/setReport\(null\)/);assert.match(queue,/setJobs\(\[\]\)/);
 const overview=readFileSync('src/components/china-order-manager/InventoryStockOverviewPanel.tsx','utf8');
 assert.match(overview,/재고가 없다는 뜻이 아닙니다/);assert.match(overview,/마지막 정상 조회/);
});
