import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import {
  prioritizeKeywordElonCandidatePool,
  planKeywordElonSelectionRecovery,
  keywordElonScoreUnavailable,
  KEYWORD_ELON_RECOVERY_VERSION,
} from "../src/lib/keywordEngineElonSelectionRecovery.ts";
const identity = {coreProduct:"패딩장갑", primarySeeds:["남성 방수 패딩장갑","패딩 장갑"], identityAnchor:"남성용 패딩장갑"};
const broad = Array.from({length:600}, (_,i) => `unrelated${i}`);
const discovery = {candidates:broad.slice(0,500),sourceTagsByKeyword:{},searchAdStats:[]};
const row = (keyword, rationale="관련성 10 · 카테고리 0") => ({keyword,searchKey:keyword,rationale,safetyPass:false,titleEligible:false,relevance:10,qualityScore:0});
test("500 cap reserves identity before broad demand", () => {
  const result=prioritizeKeywordElonCandidatePool(identity,broad);
  assert.equal(result.length,500);
  assert.deepEqual(result.slice(0,3),["패딩장갑","남성방수패딩장갑","남성용패딩장갑"]);
  assert.equal(new Set(result).size,result.length);
});
test("canonical normalization deduplicates seeds", () => {
  assert.deepEqual(prioritizeKeywordElonCandidatePool({coreProduct:"Ａ B",primarySeeds:["a-b",""],identityAnchor:"ab"},["A B","other"]),["ab","other"]);
});
test("omitted seeds recalled without inventing scores or demand", () => {
  const before=JSON.stringify(discovery);
  const plan=planKeywordElonSelectionRecovery({identity,discovery,candidates:broad.slice(0,500).map(term=>row(term))});
  assert.deepEqual(plan.keywords,["패딩장갑","남성방수패딩장갑","남성용패딩장갑"]);
  assert.equal(plan.missingIdentitySeedCount,3);
  assert.equal(JSON.stringify(discovery),before);
});
test("partial scoring failure differs from valid zero score", () => {
  assert.equal(keywordElonScoreUnavailable(row("a","AI 점수화 실패 · AI_SCORE_TIMEOUT")),true);
  assert.equal(keywordElonScoreUnavailable(row("a","AI 점수 응답 누락 · 안전Gate 탈락")),true);
  assert.equal(keywordElonScoreUnavailable(row("a")),false);
});
test("semantic rejections are not re-scored for a lucky pass", () => {
  const terms=prioritizeKeywordElonCandidatePool(identity,[]);
  assert.equal(planKeywordElonSelectionRecovery({identity,discovery:{...discovery,candidates:terms},candidates:terms.map(term=>row(term))}),null);
});
test("48 term ceiling and two durable attempts", () => {
  const candidates=broad.slice(0,500).map(term=>row(term,"AI 점수화 실패 · AI_SCORE_TIMEOUT"));
  const first=planKeywordElonSelectionRecovery({identity,discovery,candidates});
  assert.equal(first.keywords.length,48);
  assert.equal(first.unavailableScoreCount,500);
  const second=planKeywordElonSelectionRecovery({identity,discovery,candidates,previous:first});
  assert.equal(second.attempts,2);
  assert.equal(planKeywordElonSelectionRecovery({identity,discovery,candidates,previous:second}),null);
});
test("corrupt counters fail closed", () => {
  for(const attempts of [-1,NaN,Infinity,0.5,"bad"])
    assert.equal(planKeywordElonSelectionRecovery({identity,discovery,candidates:[],previous:{version:KEYWORD_ELON_RECOVERY_VERSION,attempts}}),null);
});
test("stored core and direct-seed evidence outrank unrelated depth2", () => {
  const plan=planKeywordElonSelectionRecovery({identity,candidates:[],discovery:{...discovery,searchAdStats:[{keyword:"바이크패딩장갑",sourceSeeds:[]},{keyword:"방한장갑",sourceSeeds:["패딩 장갑"]}]}});
  assert(plan.keywords.indexOf("바이크패딩장갑")<plan.keywords.indexOf("unrelated0"));
  assert(plan.keywords.indexOf("방한장갑")<plan.keywords.indexOf("unrelated0"));
});
test("successfully evaluated terms are not paid for again", () => {
  const candidates=prioritizeKeywordElonCandidatePool(identity,[]).map(term=>row(term));
  assert.equal(planKeywordElonSelectionRecovery({identity,discovery:{...discovery,candidates:[]},candidates,previous:{version:KEYWORD_ELON_RECOVERY_VERSION,attempts:1}}),null);
});
async function harness({throwScore=false}={}) {
  let persisted={run_id:"test-run",stage:"filter_keywords",status:"running",input_payload:{launchItemId:"item",sourceUrl:"shopling://legacy/1",customBlockedTerms:["교정","발열"]},checkpoint_payload:{source:{},identity,discovery,candidates:[]}};
  const calls={score:0,filter:0,patch:0};
  const globalsKey=`__legacyRecovery_${Math.random().toString(36).slice(2)}`;
  globalThis[globalsKey]={
    prioritizeKeywordElonCandidatePool,planKeywordElonSelectionRecovery,
    normalizeKeywordElonSelectionThresholds:()=>({demandQuality:65,accuracyRelevance:90}),
    selectKeywordElonStep4Union:(rows)=>rows.filter(r=>r.safetyPass&&r.titleEligible&&r.relevance>=90),
    compactKeywordElonKey:v=>String(v).replace(/[^0-9A-Za-z가-힣]/g,"").toLowerCase(),
    mergeKeywordElonCandidates:(base,added)=>[...base,...added],
    patchClaimedLegacySeoRunJob:async (_config,id,_worker,patch)=>{assert.equal(id,"test-run");calls.patch++;persisted={...persisted,...patch};return persisted;},
    scoreKeywordElonCandidatesBatched:async input=>{
      calls.score++;
      assert.equal(persisted.checkpoint_payload.selectionRecovery.status,"scoring");
      assert(persisted.checkpoint_payload.selectionRecovery.attempts>0);
      assert(input.discovery.candidates.length<=48);
      if(throwScore)throw Error("AI_SCORE_TIMEOUT");
      return {candidates:[{...row("패딩장갑"),safetyPass:true,titleEligible:true,relevance:95}],scoringSuccessfulChunks:1,scoringWarnings:[]};
    },
    filterKeywordElonProhibitedKeywords:async input=>{calls.filter++;assert.deepEqual(input.customBlockedTerms,["교정","발열"]);return {allowedKeys:["패딩장갑"],decisions:[]};},
  };
  const path=new URL("../src/lib/legacySeoRunWorker.ts",import.meta.url);
  const original=await readFile(path,"utf8");
  const strippedImports=original.replace(/import[\s\S]*?from\s+["'][^"']+["'];\n/g,"");
  const injected=`const {${Object.keys(globalThis[globalsKey]).join(",")}}=globalThis[${JSON.stringify(globalsKey)}];\n`;
  const js=stripTypeScriptTypes(injected+strippedImports+"\nexport {executeStage};",{mode:"strip"});
  const module=await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
  return {calls,get:()=>persisted,run:()=>module.executeStage({},persisted,"test-worker"),set:value=>{persisted={...persisted,...value};},cleanup:()=>delete globalThis[globalsKey]};
}
test("worker reserves attempt before score and yields without title/filter bypass", async()=>{
  const h=await harness();
  try {
    const recovered=await h.run();
    assert.equal(recovered.status,"queued");assert.equal(recovered.stage,"filter_keywords");
    assert.equal(recovered.lease_owner,null);assert.equal(recovered.lease_until,null);
    assert.equal(h.calls.score,1);assert.equal(h.calls.filter,0);
    h.set({status:"running"});
    const filtered=await h.run();
    assert.equal(filtered.stage,"generate_title");assert.equal(h.calls.filter,1);assert.equal(h.calls.score,1);
  } finally {h.cleanup();}
});
test("API failure retains paid attempt and stops after two",async()=>{
  const h=await harness({throwScore:true});
  try {
    await assert.rejects(h.run(),/AI_SCORE_TIMEOUT/);assert.equal(h.get().checkpoint_payload.selectionRecovery.attempts,1);
    await assert.rejects(h.run(),/AI_SCORE_TIMEOUT/);assert.equal(h.get().checkpoint_payload.selectionRecovery.attempts,2);
    await assert.rejects(h.run(),/기준 미충족/);assert.equal(h.calls.score,2);assert.equal(h.calls.filter,0);
  } finally {h.cleanup();}
});
test("production threshold and category/safety gate constants remain unchanged",async()=>{
  const selection=await readFile(new URL("../src/lib/keywordEngineElonLabV2Selection.ts",import.meta.url),"utf8");
  const scoring=await readFile(new URL("../src/lib/keywordEngineElonLabV2Scoring.ts",import.meta.url),"utf8");
  assert.match(selection,/DEFAULT_DEMAND_QUALITY = 65/);assert.match(selection,/DEFAULT_ACCURACY_RELEVANCE = 90/);
  assert.match(scoring,/CATEGORY_MATCH_GATE = 85/);assert.match(scoring,/row\.relevance >= 85/);
  assert.match(scoring,/calculated\.safetyPass && categoryAligned/);
});
