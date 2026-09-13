import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Supabase SEO RUN 원장은 RLS·service_role·SKIP LOCKED lease와 실패 전용 재시도 카운트를 사용한다", async () => {
  const base = await source(
    "supabase/migrations/202608280001_seo_run_durable_jobs.sql",
  );
  const serial = await source(
    "supabase/migrations/202608280002_seo_run_same_item_serial_claim.sql",
  );
  const retryAndChain = await source(
    "supabase/migrations/202608280003_seo_run_retry_and_title_chaining.sql",
  );
  const opaqueSecretCompat = await source(
    "supabase/migrations/202608280005_seo_run_opaque_secret_rpc_compat.sql",
  );
  assert.match(base, /create table if not exists public\.seo_run_jobs/);
  assert.match(base, /checkpoint_payload jsonb/);
  assert.match(base, /result_payload jsonb/);
  assert.match(base, /enable row level security/);
  assert.match(base, /revoke all on table public\.seo_run_jobs from public, anon, authenticated/);
  assert.match(base, /grant select, insert, update, delete on table public\.seo_run_jobs to service_role/);
  assert.match(base, /for update skip locked/);
  assert.match(serial, /active\.launch_item_id = job\.launch_item_id/);
  assert.match(serial, /active\.lease_until > now\(\)/);

  assert.match(retryAndChain, /enforce_seo_run_failure_attempts/);
  assert.match(retryAndChain, /old\.status = 'running'/);
  assert.match(retryAndChain, /new\.attempt_count := old\.attempt_count \+ 1/);
  assert.match(retryAndChain, /new\.status := 'failed'/);
  assert.match(retryAndChain, /propagate_ready_seo_run_titles/);
  assert.match(retryAndChain, /excludedMallTitles/);
  assert.match(retryAndChain, /pending\.status = 'queued'/);

  assert.match(opaqueSecretCompat, /create or replace function public\.claim_next_seo_run_job/);
  assert.doesNotMatch(opaqueSecretCompat, /request\.jwt\.claim\.role/);
  assert.doesNotMatch(
    opaqueSecretCompat,
    /set status = 'running',\s*attempt_count = attempt_count \+ 1/s,
  );
  assert.match(
    opaqueSecretCompat,
    /revoke all on function public\.claim_next_seo_run_job\(text, integer\)[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    opaqueSecretCompat,
    /grant execute on function public\.claim_next_seo_run_job\(text, integer\)[\s\S]*to service_role/,
  );
});

test("SEO RUN API는 enqueue·retry 즉시 실행도 예약 worker와 같은 전역 pulse를 사용한다", async () => {
  const route = await source("src/app/api/seo-run-jobs/route.ts");
  assert.match(route, /requireSeoTitleLedgerContext/);
  assert.match(route, /readProductLaunchNormalizedItems/);
  assert.match(route, /insertSeoRunJobs/);
  assert.match(route, /action === "enqueue"/);
  assert.match(route, /after\(async \(\) =>/);
  assert.match(route, /runCoalescedSeoRunWorkerPulse/);
  assert.match(route, /leaseSeconds: 300/);
  assert.doesNotMatch(route, /processSeoRunQueue/);
  assert.match(route, /variationSeed: run\.runId/);
  assert.match(route, /excludedMallTitles/);
  assert.match(route, /action === "retry"/);
  assert.match(route, /action === "archive"/);
});

test("SEO 체크포인트 저장은 읽기보다 긴 write timeout과 모호한 응답 재확인을 사용한다", async () => {
  const storage = await source("src/lib/seoRunJobServer.ts");
  assert.match(storage, /const SEO_RUN_READ_TIMEOUT_MS = 12_000/);
  assert.match(storage, /const SEO_RUN_WRITE_TIMEOUT_MS = 30_000/);
  assert.match(storage, /const SEO_RUN_PATCH_RECONCILE_ATTEMPTS = 2/);
  assert.match(storage, /storageTimeoutError/);
  assert.match(storage, /SEO_RUN_STORAGE_\$\{method\}_TIMEOUT/);
  assert.match(storage, /readSeoRunJobByIdWithOptions/);
  assert.match(storage, /patchWasApplied/);
  assert.match(storage, /sameInstant/);
  assert.match(storage, /SeoRunLeaseLostError/);
  assert.match(storage, /attempts: 2/);
  assert.match(storage, /timeoutMs: 10_000/);
  assert.match(storage, /timeoutMs: 15_000/);
});

test("Vercel worker는 STEP별 체크포인트를 저장하고 한 RUN 오류가 전체 큐를 중단시키지 않는다", async () => {
  const worker = await source("src/lib/seoRunWorker.ts");
  for (const stage of [
    "collect_source",
    "analyze_identity",
    "discover_keywords",
    "score_keywords",
    "expand_keywords",
    "filter_keywords",
    "generate_title",
    "compose_final",
    "completed",
  ]) {
    assert.match(worker, new RegExp(stage));
  }
  assert.match(worker, /claimNextSeoRunJob/);
  assert.match(worker, /patchClaimedSeoRunJob/);
  assert.match(worker, /checkpoint_payload/);
  assert.match(worker, /status: "queued"/);
  assert.match(worker, /다음 서버 실행에서 이어갑니다/);
  assert.match(worker, /status: "ready"/);
  assert.match(worker, /result_payload: result/);
  assert.match(worker, /collectKeywordElonBulkSource/);
  assert.match(worker, /composeKeywordElonBulkFinal/);
  assert.match(worker, /minimumStageStartBudgetMs/);
  assert.match(worker, /Promise\.allSettled/);
  assert.match(worker, /isSeoRunLeaseLostError/);
  assert.match(worker, /failed to persist retry state/);
  assert.match(worker, /error_message: ""/);
});

test("durable worker도 검색어가 10개 미만이면 기존 STEP4 안전복구를 사용한다", async () => {
  const worker = await source("src/lib/seoRunWorker.ts");
  assert.match(worker, /generateSafeBulkKeywordSupplements/);
  assert.match(worker, /composeFinalWithRecovery/);
  assert.match(worker, /FINAL 검색어가 10개가 아닙니다/);
  assert.match(worker, /supplementalSearchKeywords/);
  assert.match(worker, /customBlockedTerms: input\.customBlockedTerms \?\? \[\]/);
  assert.match(worker, /compose_final: 100_000/);
  assert.match(worker, /const result = await composeFinalWithRecovery/);
});

test("희소 상품 복구는 사실 토큰과 핵심상품어 조합을 충분히 만든 뒤 STEP4를 다시 통과한다", async () => {
  const recovery = await source("src/lib/keywordEngineElonBulkKeywordRecovery.ts");
  assert.match(recovery, /TARGET_CANDIDATES = 24/);
  assert.match(recovery, /modifierTokens/);
  assert.match(recovery, /buildDeterministicBulkKeywordRecoverySeeds/);
  assert.match(recovery, /seeds\.push\(`\$\{modifier\}\$\{core\.noun\}`\)/);
  assert.match(
    recovery,
    /seeds\.push\(`\$\{modifiers\[left\]\}\$\{modifiers\[right\]\}\$\{core\.noun\}`\)/,
  );
  assert.match(recovery, /deterministic\.length >= TARGET_CANDIDATES/);
  assert.match(recovery, /filterKeywordElonProhibitedKeywords/);
  assert.match(recovery, /\.slice\(0, 30\)/);
  assert.match(recovery, /\/\\d\/\.test\(key\)/);
});

test("durable SEO 복구는 단일 adaptive dispatcher의 critical task로 실행된다", async () => {
  const standalone = await source("src/app/api/cron/seo-run-worker/route.ts");
  const shared = await source(
    "src/app/api/cron/receipt-live-price-proposals/route.ts",
  );
  const pulse = await source("src/lib/seoRunWorkerPulse.ts");
  const scheduler = await source(
    "supabase/migrations/202608280009_ops_adaptive_dispatcher.sql",
  );
  const vercel = JSON.parse(await source("vercel.json"));

  assert.match(standalone, /CRON_SECRET/);
  assert.match(standalone, /timingSafeEqual/);
  assert.match(standalone, /maxDuration = 300/);
  assert.match(standalone, /runCoalescedSeoRunWorkerPulse/);
  assert.match(pulse, /processSeoRunQueue/);
  assert.match(pulse, /claimSeoRunWorkerPulse/);
  assert.match(pulse, /finishSeoRunWorkerPulse/);

  assert.doesNotMatch(shared, /processSeoRunQueue/);
  assert.doesNotMatch(shared, /scheduleDurableSeoRunRecovery/);
  assert.match(
    scheduler,
    /'seo-run-worker', '\/api\/cron\/seo-run-worker', 'critical', 10, true, 300, 60, 300/,
  );
  assert.deepEqual(vercel.crons, [
    { path: "/api/cron/ops-dispatcher", schedule: "* * * * *" },
  ]);
});

test("과거 Supabase wakeup 안전장치는 전역 lease를 보존하되 DB HTTP cron은 최종적으로 제거된다", async () => {
  const originalWakeupMigration = await source(
    "supabase/migrations/202608280004_seo_run_supabase_wakeup.sql",
  );
  const retirementMigration = await source(
    "supabase/migrations/202608280008_optimize_seo_claim_and_remove_duplicate_wakeup.sql",
  );
  const opaqueSecretCompat = await source(
    "supabase/migrations/202608280005_seo_run_opaque_secret_rpc_compat.sql",
  );
  const wakeup = await source("src/app/api/seo-run-wakeup/route.ts");
  const control = await source("src/lib/seoRunWorkerControl.ts");

  assert.match(originalWakeupMigration, /create extension if not exists pg_cron/);
  assert.match(originalWakeupMigration, /create extension if not exists pg_net/);
  assert.match(originalWakeupMigration, /create table if not exists public\.seo_run_worker_control/);
  assert.match(originalWakeupMigration, /claim_seo_run_worker_pulse/);
  assert.match(originalWakeupMigration, /finish_seo_run_worker_pulse/);
  assert.match(originalWakeupMigration, /commerce-os-seo-run-wakeup/);

  assert.match(retirementMigration, /cron\.unschedule/);
  assert.match(retirementMigration, /commerce-os-seo-run-wakeup/);
  assert.doesNotMatch(retirementMigration, /cron\.schedule\s*\(/);
  assert.doesNotMatch(retirementMigration, /net\.http_get/);

  assert.match(opaqueSecretCompat, /claim_seo_run_worker_pulse/);
  assert.match(opaqueSecretCompat, /finish_seo_run_worker_pulse/);
  assert.doesNotMatch(opaqueSecretCompat, /request\.jwt\.claim\.role/);
  assert.match(opaqueSecretCompat, /to service_role/);

  assert.match(wakeup, /claimSeoRunWorkerPulse/);
  assert.match(wakeup, /processSeoRunQueue/);
  assert.match(wakeup, /finishSeoRunWorkerPulse/);
  assert.match(wakeup, /throttled: true/);
  assert.doesNotMatch(wakeup, /results:\s*result\.results/);
  assert.match(control, /rpc\/claim_seo_run_worker_pulse/);
  assert.match(control, /rpc\/finish_seo_run_worker_pulse/);
  assert.match(control, /AbortSignal\.timeout/);
});

test("SEO 클라우드는 서버 원장을 polling하고 인계 완료 후 localStorage 실행본을 제거한다", async () => {
  const page = await source("src/app/seo-bulk-cloud/page.tsx");
  const client = await source(
    "src/app/seo-bulk-cloud/SeoBulkDurableRunCloudClient.tsx",
  );
  assert.match(page, /SeoBulkDurableRunCloudClient/);
  assert.match(client, /\/api\/seo-run-jobs/);
  assert.match(client, /action: "enqueue"/);
  assert.match(client, /window\.localStorage\.removeItem\(BATCH_STORAGE_KEY\)/);
  assert.match(client, /POLL_INTERVAL_MS = 4_000/);
  assert.match(client, /컴퓨터를 꺼도/);
  assert.match(client, /저장된 서버 체크포인트/);
  assert.match(client, /Shopling 일괄 대량등록/);
  assert.match(client, /registration_job_id/);
});

test("자연어 복구 실제 코드는 메타데이터·숫자를 제외하고 STEP4 허용 결과만 반환한다", async () => {
  const { stripTypeScriptTypes } = await import("node:module");
  const { compactKeywordElonKey, keywordElonUtf8Bytes, normalizeKeywordElonText } = await import("../src/lib/keywordEngineElonLabV2.ts");
  const raw = await source("src/lib/keywordEngineElonBulkKeywordRecovery.ts");
  const code = stripTypeScriptTypes(raw.replace(/^import[\s\S]*?;\n/gm, "").replace(/\bexport /g, ""), { mode: "strip" });
  const calls = [];
  const blocked = ["원형받침대"];
  const filter = async input => {
    calls.push(input);
    return { allowedKeys: ["세탁기받침대"], removedKeys: blocked };
  };
  const run = new Function("compactKeywordElonKey", "keywordElonUtf8Bytes", "normalizeKeywordElonText", "filterKeywordElonProhibitedKeywords", "process", "fetch",
    code + "; return { seeds: buildDeterministicBulkKeywordRecoverySeeds, generate: generateSafeBulkKeywordSupplements };")(
      compactKeywordElonKey, keywordElonUtf8Bytes, normalizeKeywordElonText, filter, { env: {} }, () => { throw new Error("No external network allowed"); });
  const input = {
    productName: "형태 원형 세탁기 받침대",
    identity: { coreProduct: "세탁기 받침대", identityAnchor: "세탁기받침대", primarySeeds: ["세탁기받침대"],
      conditionalSeeds: ["원형받침대"], koreanProductIdentity: "세탁기 받침대", functionModifiers: ["세탁기 지지"],
      designShapeModifiers: ["형태 원형"], specAttributes: ["지름15cm", "재질 철제"] },
    source: { chineseTitle: "", optionText: "" }, customBlockedTerms: blocked,
  };
  const seeds = run.seeds(input);
  assert.ok(seeds.includes("세탁기받침대"));
  assert.ok(seeds.length > 1 && seeds.length <= 60);
  assert.equal(new Set(seeds).size, seeds.length);
  for (const key of seeds) {
    assert.ok(key.includes("받침대"));
    assert.ok(keywordElonUtf8Bytes(key) <= 30);
    assert.doesNotMatch(key, /형태|재질|용도|있는|옵션|모델번호|\d/);
  }
  assert.deepEqual(await run.generate(input), ["세탁기받침대"]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].customBlockedTerms, blocked);
  assert.ok(calls[0].candidates.every(row => row.totalSearch === null));
});
