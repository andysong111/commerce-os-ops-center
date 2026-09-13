import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { marketRowNeedsReview } from '../src/lib/shoplingMarketSafety.ts';
const ts = createRequire(import.meta.url)('typescript');
const route = fs.readFileSync(new URL('../src/app/api/shopling-market-group-canary/v0337/claim/route.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(route, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const channels = ['wholesale1','wholesale2','wholesale3','wholesale4','retail1','retail2'];
const prefixes = ['DM1','DM2','DM3','DM4','SM1','SM2'];
const jobId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
function fixture() {
  return channels.map((channel, i) => ({ goods_key: String(120000+i), launch_item_id:'launch', model_number:'TEST001', product_group_key:channel, ptn_goods_cd:prefixes[i]+'_TEST', status:'queued', market_status:'pending', submit_armed_at:null, reason_code:'', claim_run_id:'', claimed_at:null }));
}
function handler(ledger) {
  const updates=[];
  const job={id:jobId,owner_id:'owner',launch_item_id:'launch',status:'success',payload:{seoFinal:{source:'seo-bulk-cloud-test'}},result:{rows:ledger.map((r)=>({goods_key:r.goods_key,channel_key:r.product_group_key,ptn_goods_cd:r.ptn_goods_cd,status:'success'}))}};
  const db={from(table){let single=false;let patch=null;const filters=[];const q={select(){return q},eq(k,v){filters.push([k,v]);return q},in(k,v){filters.push([k,v]);return q},is(k,v){filters.push([k,v]);return q},limit(){return q},order(){return q},maybeSingle(){single=true;return q},update(p){patch=p;return q},then(resolve,reject){try{if(table==='product_launch_upload_jobs')return Promise.resolve({error:null,data:single?job:[job]}).then(resolve,reject);let data=ledger.filter(r=>filters.every(([k,v])=>k==='owner_id'||(Array.isArray(v)?v.includes(r[k]):r[k]===v)));if(patch){updates.push({patch,filters});data=data.map(r=>Object.assign(r,patch));}return Promise.resolve({error:null,data}).then(resolve,reject);}catch(e){return Promise.reject(e).then(resolve,reject)}}};return q}};
  const mod={exports:{}};
  vm.runInNewContext(js,{exports:mod.exports,module:mod,require(name){if(name==='@/lib/supabase/admin')return {createSupabaseAdminClient:async()=>db};if(name==='@/lib/shoplingMarketSafety')return {marketRowNeedsReview};throw new Error(name)},Request,Response,Date,Set,Map});
  return {post:mod.exports.POST,updates};
}
function request(runId='canary-group-v030-test-run-123456789') {return new Request('https://example.invalid/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bridge:'shopling-market-selection-all-v0.1',runId,jobId})});}

test('erased submit timestamps do not turn ambiguous sends into fresh pending',()=>{
  for(const reason of ['auto_stale_submit_preflight_reconcile_v0330','selected_stale_submit_reconcile_v0328','selected_confirm_reconcile_v0328','manual_hold_v0336_post_submit_review']) assert.equal(marketRowNeedsReview({status:'queued',market_status:'pending',submit_armed_at:null,reason_code:reason}),true);
  assert.equal(marketRowNeedsReview({status:'queued',market_status:'pending',reason_code:'auto_stale_pre_submit_released_v0331'}),false);
});
test('held six-channel job cannot be unlocked or claimed',async()=>{
  const rows=fixture();rows[0].status='confirm_needed';rows[0].market_status='confirm_needed';
  const h=handler(rows),res=await h.post(request());assert.equal(res.status,409);assert.equal((await res.json()).error,'market_registration_review_required');assert.equal(h.updates.length,0);assert.equal(rows[0].status,'confirm_needed');
});
test('stale-submit reason alone blocks replay with zero mutations',async()=>{
  const rows=fixture();rows[1].reason_code='auto_stale_submit_preflight_reconcile_v0330';const h=handler(rows);assert.equal((await h.post(request())).status,409);assert.equal(h.updates.length,0);
});
test('only five fresh pending channels are claimed when one is already sent',async()=>{
  const rows=fixture();rows[0].status='sent';rows[0].market_status='sent';rows[0].submit_armed_at='2026-09-13T00:00:00Z';
  const h=handler(rows),res=await h.post(request());assert.equal(res.status,200);const body=await res.json();assert.equal(body.taskCount,5);assert.equal(h.updates.length,1);assert.equal(rows[0].status,'sent');assert.ok(body.tasks.every(t=>t.claimEpoch));
});
test('other active run cannot be stolen',async()=>{const rows=fixture();rows[0].status='claimed';rows[0].claim_run_id='other';const h=handler(rows);assert.equal((await h.post(request())).status,409);assert.equal(h.updates.length,0);});
test('diagnostic run cannot call the real claim endpoint',async()=>{const h=handler(fixture());assert.equal((await h.post(request('canary-group-v030-diagnostic-test-123456789'))).status,400);assert.equal(h.updates.length,0);});
