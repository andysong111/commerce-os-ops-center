import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const ORIGIN='https://commerce-os-ops-center.vercel.app', PAGE='/stage8-sales-events';
const SALES='/api/product-master/shopling-sales-events';
const PARITY='/api/stage8/candidate-demand-parity', EVIDENCE='/api/stage8/candidate-mismatch-evidence';
const ASOF='2026-09-15T01:09:10.473Z';
const APIs=new Set([SALES,PARITY,EVIDENCE]);
function allow(url,method,top,body,armed){const u=new URL(url);if(u.origin!==ORIGIN||!top)return false;if(method==='GET')return u.pathname===PAGE||u.pathname.startsWith('/_next/static/')||(APIs.has(u.pathname)&&!u.search);return method==='POST'&&!u.search&&[PARITY,EVIDENCE].includes(u.pathname)&&armed?.path===u.pathname&&['start','run-next'].includes(armed?.action)&&body&&Object.keys(body).length===1&&body.action===armed.action;}
for(const path of [SALES,'/api/china-order-manager','/api/inventory-stock-control'])assert.equal(allow(ORIGIN+path,'POST',true,{action:'start'},{path,action:'start'}),false);
for(const path of [PARITY,EVIDENCE]){for(const action of ['canary','full','approve','refresh'])assert.equal(allow(ORIGIN+path,'POST',true,{action},{path,action}),false);assert.ok(allow(ORIGIN+path,'POST',true,{action:'run-next'},{path,action:'run-next'}));assert.equal(allow(ORIGIN+path,'POST',true,{action:'run-next',force:true},{path,action:'run-next'}),false);}
assert.equal(allow(ORIGIN+PARITY,'POST',false,{action:'start'},{path:PARITY,action:'start'}),false);
console.log('PARITY_EVIDENCE_READ_ONLY_BOUNDARY_PASS');
if(process.argv.includes('--self-test'))process.exit(0);
assert.equal(process.env.GITHUB_REF_NAME,'ops/sales-candidate-collect-20260915');
assert.equal(process.env.SALES_VERIFY_AUTHORIZATION,'OWNER_AUTHORIZED_CURRENT_CANDIDATE_COMPARISON');
const tools=createRequire(`${process.env.SALES_BROWSER_TOOLS}/package.json`);const {chromium}=tools('playwright');
const log={mode:'REAL_PRODUCTION_PREWRITE_COMPARISON',startedAt:new Date().toISOString(),analysisAsOf:ASOF,purchaseWrites:0,canonicalWrites:0,blockedRequests:0,steps:[],outcome:'STARTING'};
const dir='artifacts/sales-candidate-verify-20260915';await mkdir(dir,{recursive:true});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();let armed=null;
await context.routeWebSocket('**/*',s=>s.close());
await context.route('**/*',async route=>{const r=route.request();let top=false,body=null;try{top=r.frame()===page.mainFrame();}catch{}if(r.method()==='POST'){try{body=r.postDataJSON();}catch{}}if(!allow(r.url(),r.method(),top,body,armed)){log.blockedRequests++;return route.abort('blockedbyclient');}if(r.method()==='POST')armed=null;await route.continue();});
page.on('dialog',d=>d.dismiss());
async function request(path,action){assert.equal(armed,null);if(action)armed={path,action};return page.evaluate(async({path,action})=>{const response=await fetch(path,{method:action?'POST':'GET',...(action?{headers:{'content-type':'application/json'},body:JSON.stringify({action})}:{}),cache:'no-store',signal:AbortSignal.timeout(290000)});return {http:response.status,data:await response.json()};},{path,action});}
async function status(path){const r=await request(path,null);assert.equal(r.http,200,'STATUS_HTTP_FAILED');assert.equal(r.data.ok,true,'STATUS_NOT_OK');assert.equal(r.data.status.configured,true,'NOT_CONFIGURED');return r.data.status;}
let source;
async function verifySource(){const current=await status(SALES);assert.equal(current.requestId,source.requestId,'CANDIDATE_CHANGED');assert.equal(current.analysisAsOf,ASOF,'CANDIDATE_TIME_CHANGED');assert.equal(current.report?.planFingerprint,source.report.planFingerprint,'CANDIDATE_PLAN_CHANGED');return current;}
function reportSummary(report){if(!report)return null;const fields=['analysisAsOf','candidateSalesRequestId','candidateParityRequestId','candidatePlanFingerprint','candidateParityFingerprint','parityFingerprint','evidenceFingerprint','candidateRowCount','exactRowCount','unitMismatchCount','revenueMismatchCount','missingDirectCount','directOnlyManagedCount','directUnmappedRows','blockerCount','unresolvedCount','explainedCount'];return Object.fromEntries(fields.filter(k=>report[k]!==undefined).map(k=>[k,report[k]]));}
async function runStage(path,kind,parityFingerprint){
 await verifySource();let current=await status(path);let id=current.requestId;
 const belongs=current.report?.candidateSalesRequestId===source.requestId&&current.report?.analysisAsOf===ASOF&&(kind==='parity'?current.report?.candidatePlanFingerprint===source.report.planFingerprint:current.report?.candidateParityFingerprint===parityFingerprint);
 if(!belongs){
  assert.ok(!['QUEUED','RUNNING'].includes(current.state),'OTHER_COMPARISON_ACTIVE');
  const created=await request(path,'start');assert.equal(created.http,202,'COMPARISON_NOT_ACCEPTED');assert.equal(created.data.ok,true);assert.equal(created.data.accepted,true);assert.equal(created.data.candidateSalesRequestId,source.requestId);assert.equal(created.data.analysisAsOf,ASOF);
  if(kind==='parity')assert.equal(created.data.candidatePlanFingerprint,source.report.planFingerprint);else assert.equal(created.data.candidateParityFingerprint,parityFingerprint);
  id=created.data.requestId;log[kind+'RequestId']=id;
 }
 const deadline=Date.now()+9*60_000;
 for(let i=0;i<64&&Date.now()<deadline;i++){
  current=await status(path);assert.equal(current.requestId,id,'COMPARISON_REQUEST_CHANGED');
  if(!['QUEUED','RUNNING'].includes(current.state))break;
  if(i%10===0){await verifySource();console.log(JSON.stringify({kind,requestId:id,state:current.state,completedRanges:current.completedRanges,totalRanges:current.totalRanges}));}
  const step=await request(path,'run-next');assert.equal(step.http,200,'COMPARISON_STEP_HTTP_FAILED');assert.equal(step.data.ok,true);if(step.data.result?.requestId)assert.equal(step.data.result.requestId,id);
  log.steps.push({kind,state:step.data.result?.state,processed:step.data.result?.processed});
 }
 current=await status(path);assert.equal(current.requestId,id);await verifySource();
 log[kind]={requestId:id,state:current.state,completedRanges:current.completedRanges,totalRanges:current.totalRanges,blockerCount:current.blockerCount,report:reportSummary(current.report)};
 console.log(JSON.stringify({kind,...log[kind]}));await writeFile(`${dir}/result.json`,JSON.stringify(log,null,2));return current;
}
try{
 const nav=await page.goto(ORIGIN+PAGE,{waitUntil:'domcontentloaded',timeout:120000});assert.equal(nav.status(),200);assert.equal(new URL(page.url()).pathname,PAGE,'LOGIN_REQUIRED');
 source=await status(SALES);assert.equal(source.analysisAsOf,ASOF,'NEWER_OR_OLDER_SOURCE_STOP');assert.ok(['READY_CANARY','READY_FULL','COMPLETED'].includes(source.state),'COLLECTION_NOT_READY');assert.ok(/^sha256:[a-f0-9]{64}$/.test(source.report?.planFingerprint??''));assert.equal(source.report.unmappedRows,0);assert.equal(source.report.identityConflictCount,0);
 log.source={requestId:source.requestId,analysisAsOf:ASOF,planFingerprint:source.report.planFingerprint,sourceEventCount:source.report.sourceEventCount};
 const parity=await runStage(PARITY,'parity');
 if(parity.state==='MATCH')log.outcome='EXACT_PARITY_COMPLETE_REQUIRES_NORMAL_PROMOTION';
 else if(parity.state==='MISMATCH'){
  assert.ok(/^sha256:[a-f0-9]{64}$/.test(parity.report?.parityFingerprint??''));
  const evidence=await runStage(EVIDENCE,'evidence',parity.report.parityFingerprint);log.outcome='EVIDENCE_'+evidence.state+'_REQUIRES_GATE_REVIEW';
 }else log.outcome='PARITY_'+parity.state;
 console.log('PREWRITE_VERIFICATION_OUTCOME='+log.outcome);
}catch(error){log.outcome='STOPPED_FOR_INSPECTION';log.failure=String(error.message).split('\n')[0].slice(0,160);console.error('PREWRITE_VERIFICATION_STOPPED');process.exitCode=1;}
finally{log.finishedAt=new Date().toISOString();await writeFile(`${dir}/result.json`,JSON.stringify(log,null,2));await browser.close();}
