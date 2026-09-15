import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const ORIGIN = 'https://commerce-os-ops-center.vercel.app';
const PAGE = '/stage8-sales-events', API = '/api/product-master/shopling-sales-events';
const ASOF = '2026-09-15T01:09:10.473Z';
let expectedId = 'ea702296-a8b9-4f49-af00-1e5d46ce702e';
function allowed(url, method, top, body, armed) {
  const u = new URL(url);
  if (u.origin !== ORIGIN || !top) return false;
  if (method === 'GET') return u.pathname === PAGE || u.pathname.startsWith('/_next/static/') || (u.pathname === API && !u.search);
  return method === 'POST' && u.pathname === API && !u.search && ['start','run-burst'].includes(armed)
    && body && Object.keys(body).length === 1 && body.action === armed;
}
for (const bad of ['refresh','canary','full','approve','RESET_ZERO']) assert.equal(allowed(ORIGIN+API,'POST',true,{action:bad},bad),false);
assert.equal(allowed(ORIGIN+API,'POST',true,{action:'start'},null),false);
assert.equal(allowed(ORIGIN+API,'POST',true,{action:'run-burst',force:true},'run-burst'),false);
assert.equal(allowed(ORIGIN+'/api/inventory-stock-control','GET',true,null,null),false);
assert.equal(allowed(ORIGIN+API,'POST',false,{action:'start'},'start'),false);
assert.ok(allowed(ORIGIN+API,'POST',true,{action:'start'},'start'));
assert.ok(allowed(ORIGIN+API,'POST',true,{action:'run-burst'},'run-burst'));
console.log('RECOVERY_BOUNDARY_SELF_TEST_PASS');
if (process.argv.includes('--self-test')) process.exit(0);
assert.equal(process.env.GITHUB_REF_NAME, 'ops/sales-candidate-collect-20260915');
assert.equal(process.env.SALES_COLLECTION_AUTHORIZATION, 'OWNER_AUTHORIZED_CURRENT_SALES_COLLECTION');
const tools=createRequire(`${process.env.SALES_BROWSER_TOOLS}/package.json`);
const {chromium}=tools('playwright');
const evidence={mode:'REAL_PRODUCTION_EXISTING_RECOVERY_COLLECTION_ONLY',startedAt:new Date().toISOString(),rootRequestId:expectedId,analysisAsOf:ASOF,recoveryRequests:0,burstRequests:0,purchaseWrites:0,canonicalWrites:0,blockedRequests:0,snapshots:[],recoveries:[],outcome:'STARTING'};
const dir='artifacts/sales-candidate-recover-20260915';await mkdir(dir,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({serviceWorkers:'block'});
const page=await context.newPage();let armed=null;
await context.routeWebSocket('**/*',s=>s.close());
await context.route('**/*',async route=>{
 const r=route.request();let top=false,body=null;
 try{top=r.frame()===page.mainFrame();}catch{}
 if(r.method()==='POST'){try{body=r.postDataJSON();}catch{}}
 if(!allowed(r.url(),r.method(),top,body,armed)){evidence.blockedRequests++;return route.abort('blockedbyclient');}
 if(r.method()==='POST'){if(armed==='start')evidence.recoveryRequests++;else evidence.burstRequests++;armed=null;}
 await route.continue();
});
page.on('dialog',d=>d.dismiss());
function pick(s){return {at:new Date().toISOString(),requestId:s.requestId,analysisAsOf:s.analysisAsOf,state:s.state,completedRanges:s.completedRanges,totalRanges:s.totalRanges,blockerCount:s.blockerCount,planFingerprint:s.report?.planFingerprint??null,sourceEventCount:s.report?.sourceEventCount??null,unmappedRows:s.report?.unmappedRows??null,identityConflictCount:s.report?.identityConflictCount??null};}
async function request(action){
 assert.equal(armed,null);if(action)armed=action;
 return await page.evaluate(async ({api,action})=>{
  const response=await fetch(api,{method:action?'POST':'GET',...(action?{headers:{'content-type':'application/json'},body:JSON.stringify({action})}:{}),cache:'no-store',signal:AbortSignal.timeout(290000)});
  return {http:response.status,data:await response.json()};
 },{api:API,action});
}
async function status(){const r=await request(null);assert.equal(r.http,200,'STATUS_HTTP_FAILED');assert.equal(r.data.ok,true,'STATUS_FAILED');const s=r.data.status;assert.equal(s.configured,true);assert.equal(s.analysisAsOf,ASOF,'ANALYSIS_CHANGED_STOP');assert.equal(s.requestId,expectedId,'REQUEST_CHANGED_STOP');const row=pick(s);evidence.snapshots.push(row);console.log(JSON.stringify(row));return s;}
try{
 const nav=await page.goto(ORIGIN+PAGE,{waitUntil:'domcontentloaded',timeout:120000});assert.equal(nav.status(),200);assert.equal(new URL(page.url()).pathname,PAGE,'LOGIN_REQUIRED');
 const deadline=Date.now()+12*60_000;
 for(let actions=0;actions<12&&Date.now()<deadline;actions++){
  const s=await status();
  if(!['FAILED','QUEUED','RUNNING'].includes(s.state)){evidence.outcome=s.state;break;}
  if(s.state==='FAILED'){
   if(evidence.recoveryRequests>=6){evidence.outcome='RECOVERY_BUDGET_REACHED';break;}
   const r=await request('start');
   if(r.http===409){evidence.outcome='RECOVERY_HELD';break;}
   assert.equal(r.http,202,'RECOVERY_HTTP_FAILED');assert.equal(r.data.recovered,true,'RECOVERY_NOT_ACCEPTED');
   assert.equal(r.data.supersedesRequestId,expectedId,'RECOVERY_PARENT_CHANGED');assert.equal(r.data.analysisAsOf,ASOF,'RECOVERY_TIME_CHANGED');
   expectedId=r.data.requestId;evidence.recoveries.push({requestId:expectedId,reason:r.data.reason,chunkDays:r.data.chunkDays,totalRanges:r.data.totalRanges});
   console.log(JSON.stringify(evidence.recoveries.at(-1)));
  }else{
   if(evidence.burstRequests>=6){evidence.outcome='BURST_BUDGET_REACHED';break;}
   const r=await request('run-burst');assert.equal(r.http,200,'BURST_HTTP_FAILED');assert.equal(r.data.ok,true,'BURST_FAILED');
   if(r.data.result?.requestId)assert.equal(r.data.result.requestId,expectedId,'BURST_REQUEST_CHANGED');
   console.log(JSON.stringify({burstState:r.data.result?.state,stepCount:r.data.result?.stepCount,elapsedMs:r.data.result?.elapsedMs}));
  }
  await writeFile(`${dir}/result.json`,JSON.stringify(evidence,null,2));
 }
 const final=await status();evidence.final=pick(final);
 if(['READY_CANARY','READY_FULL','COMPLETED','BLOCKED','STORAGE_NOT_READY'].includes(final.state))evidence.outcome=final.state;
 else if(evidence.outcome==='STARTING')evidence.outcome='BOUNDED_WORK_PENDING';
 console.log(`REAL_RECOVERY_OUTCOME=${evidence.outcome}`);
}catch(error){evidence.outcome='STOPPED_FOR_INSPECTION';evidence.failure=String(error.message).split('\n')[0].slice(0,160);console.error('RECOVERY_STOPPED_FOR_INSPECTION');process.exitCode=1;}
finally{evidence.finishedAt=new Date().toISOString();await writeFile(`${dir}/result.json`,JSON.stringify(evidence,null,2));await browser.close();}
