import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestPath = new URL("../public/shopling-account-title-bridge/manifest.json", import.meta.url);
const titleContentPath = new URL("../public/shopling-account-title-bridge/content-shopling-account-titles.js", import.meta.url);
const listContentPath = new URL("../public/shopling-account-title-bridge/content-shopling-product-list-batch.js", import.meta.url);
const registryListBridgePath = new URL("../public/shopling-account-title-bridge/content-shopling-product-list-registry-bridge.js", import.meta.url);
const lifecycleDiagnosticPath = new URL("../public/shopling-account-title-bridge/content-shopling-lifecycle-diagnostic.js", import.meta.url);
const pipelineContentPath = new URL("../public/shopling-account-title-bridge/content-shopling-pipeline.js", import.meta.url);
const frameBridgePath = new URL("../public/shopling-account-title-bridge/content-shopling-pipeline-frame-bridge.js", import.meta.url);
const stabilityBridgePath = new URL("../public/shopling-account-title-bridge/content-shopling-onebutton-stability-v054.js", import.meta.url);
const titleBackgroundPath = new URL("../public/shopling-account-title-bridge/background-shopling-title-batch.js", import.meta.url);
const titleRegistryBackgroundPath = new URL("../public/shopling-account-title-bridge/background-shopling-title-registry.js", import.meta.url);
const pipelineBackgroundPath = new URL("../public/shopling-account-title-bridge/background-shopling-pipeline.js", import.meta.url);
const lifecycleBackgroundPath = new URL("../public/shopling-account-title-bridge/background-shopling-lifecycle.js", import.meta.url);
const backgroundRootPath = new URL("../public/shopling-account-title-bridge/background-shopling-root.js", import.meta.url);
const backgroundSeoPath = new URL("../public/shopling-account-title-bridge/background-shopling-seo-keywords.js", import.meta.url);
const downloadRoutePath = new URL("../src/app/api/shopling-account-title-bridge/download/route.ts", import.meta.url);
const keywordPoolRoutePath = new URL("../src/app/api/shopling-account-title-bridge/keyword-pool/route.ts", import.meta.url);
const titleRegistryRoutePath = new URL("../src/app/api/shopling-account-title-bridge/title-registry/route.ts", import.meta.url);
const pipelineRoutePath = new URL("../src/app/api/shopling-account-title-bridge/pipeline/route.ts", import.meta.url);
const lifecycleDiagnosticRoutePath = new URL("../src/app/api/shopling-lifecycle-diagnostic/route.ts", import.meta.url);
const lifecycleBridgeRoutePath = new URL("../src/app/api/shopling-lifecycle-bridge/route.ts", import.meta.url);
const keywordPoolLibPath = new URL("../src/lib/shoplingTitleKeywordPool.ts", import.meta.url);
const pipelineMigrationPath = new URL("../supabase/migrations/202608300001_shopling_market_pipeline_idempotency_v05.sql", import.meta.url);
const titleLedgerMigrationPath = new URL("../supabase/migrations/202608300002_shopling_title_diversification_ledger_v053.sql", import.meta.url);

test("Shopling bridge source v0.5.5 keeps durable idempotency and adds lifecycle diagnostics", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.5.5");
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.host_permissions, [
    "https://a.shopling.co.kr/*",
    "https://commerce-os-ops-center.vercel.app/*",
  ]);
  assert.equal(manifest.background.service_worker, "background-shopling-root.js");
  assert.deepEqual(manifest.content_scripts[1].js, [
    "content-shopling-product-list-batch.js",
    "content-shopling-product-list-registry-bridge.js",
    "content-shopling-lifecycle-diagnostic.js",
  ]);
  assert.deepEqual(manifest.content_scripts[2].js, [
    "content-shopling-pipeline.js",
    "content-shopling-pipeline-frame-bridge.js",
    "content-shopling-onebutton-stability-v054.js",
    "content-shopling-product-db-capacity.js",
  ]);
});

test("mall-title bridge still uses verified Shopling and SEO tokens only", async () => {
  const source = await readFile(titleContentPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /const MAX_TITLE_BYTES = 100/);
  assert.match(source, /buildVerifiedTokenPool/);
  assert.match(source, /SEO_KEYWORD_POOL_MESSAGE/);
  assert.match(source, /seo_master_pool/);
  assert.doesNotMatch(source, /password|document\.cookie/i);
});

test("background root loads title, SEO, market pipeline and lifecycle bridges", async () => {
  const root = await readFile(backgroundRootPath, "utf8");
  assert.match(root, /background-shopling-title-batch\.js/);
  assert.match(root, /background-shopling-title-registry\.js/);
  assert.match(root, /background-shopling-seo-keywords\.js/);
  assert.match(root, /background-shopling-pipeline\.js/);
  assert.match(root, /background-shopling-lifecycle\.js/);
});

test("SEO keyword background remains read-only and never sends Shopling credentials", async () => {
  const source = await readFile(backgroundSeoPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /keyword-pool/);
  assert.match(source, /credentials: "omit"/);
  assert.doesNotMatch(source, /password|document\.cookie/i);
});

test("keyword-pool API keeps safety filtering", async () => {
  const route = await readFile(keywordPoolRoutePath, "utf8");
  const helper = await readFile(keywordPoolLibPath, "utf8");
  assert.match(route, /shopling_product_group_registry/);
  assert.match(route, /seo_run_jobs/);
  assert.match(helper, /safetyPass === false/);
  assert.match(helper, /titleEligible === false/);
  assert.match(helper, /categoryAligned === false/);
  assert.match(helper, /blocked === true/);
  assert.match(helper, /prohibited === true/);
});

test("legacy page collector remains only as fallback diagnostics", async () => {
  const source = await readFile(listContentPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /미분산 상품 일괄 처리/);
  assert.match(source, /collected\.expected > collected\.goodsKeys\.length/);
  assert.match(source, /credentials: "include"/);
});

test("purple title bridge claims only unhandled ledger rows and persists terminal results", async () => {
  const source = await readFile(registryListBridgePath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /TITLE_LEDGER_CLAIM_MESSAGE/);
  assert.match(source, /TITLE_LEDGER_REPORT_MESSAGE/);
  assert.match(source, /TITLE_LEDGER_RETRY_MESSAGE/);
  assert.match(source, /TITLE_LEDGER_STATS_MESSAGE/);
  assert.match(source, /LAST_RUN_STORAGE_KEY/);
  assert.match(source, /reportActiveResults/);
  assert.match(source, /실패\/중단건 재시도/);
  assert.match(source, /이전 처리상품은 열지 않습니다/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
  assert.match(source, /CHUNK_SIZE = 500/);
  assert.doesNotMatch(source, /credentials:\s*["']include["']/);
  assert.doesNotMatch(source, /password|document\.cookie/i);
});

test("title ledger background exposes claim report retry stats with no Shopling credentials", async () => {
  const source = await readFile(titleRegistryBackgroundPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /TITLE_REGISTRY_BRIDGE = "v0\.5\.3"/);
  assert.match(source, /retry-failures/);
  assert.match(source, /credentials: "omit"/);
  assert.doesNotMatch(source, /a\.shopling\.co\.kr/);
  assert.doesNotMatch(source, /password|document\.cookie/i);
});

test("title registry API is ledger-backed, recoverable by run id, and never returns historical registry wholesale", async () => {
  const source = await readFile(titleRegistryRoutePath, "utf8");
  assert.match(source, /const BRIDGE_VERSION = "v0\.5\.3"/);
  assert.match(source, /claim_shopling_title_diversification_tasks/);
  assert.match(source, /report_shopling_title_diversification_task/);
  assert.match(source, /retry_shopling_title_diversification_failures/);
  assert.match(source, /\.from\("shopling_title_diversification_ledger"\)/);
  assert.match(source, /\.eq\("claim_run_id", runId\)/);
  assert.match(source, /\.eq\("status", "claimed"\)/);
  assert.match(source, /recoveredClaimRowCount/);
  assert.doesNotMatch(source, /\.from\("shopling_product_group_registry"\)/);
  assert.doesNotMatch(source, /password|cookie/i);
});

test("lifecycle DOM scanner is read-only and only reports structural status controls", async () => {
  const source = await readFile(lifecycleDiagnosticPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /판매\\s\*중|판매\\s\*상태|품절|삭제/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /REPORT_MESSAGE/);
  assert.match(source, /formActionPath/);
  assert.match(source, /optionSnapshot/);
  assert.doesNotMatch(source, /\.click\s*\(|dispatchEvent\s*\(|requestSubmit\s*\(|\.submit\s*\(/);
  assert.doesNotMatch(source, /document\.cookie|password/i);
});

test("lifecycle background uses public bridge endpoints without Shopling credentials", async () => {
  const source = await readFile(lifecycleBackgroundPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /shopling-lifecycle-diagnostic/);
  assert.match(source, /shopling-lifecycle-bridge/);
  assert.match(source, /lifecycle-dom-v0\.5\.5/);
  assert.match(source, /lifecycle-v1/);
  assert.match(source, /credentials: "omit"/);
  assert.doesNotMatch(source, /document\.cookie|password/i);
});

test("lifecycle diagnostic API sanitizes and stores read-only structural evidence", async () => {
  const source = await readFile(lifecycleDiagnosticRoutePath, "utf8");
  assert.match(source, /SHOPLING_LIFECYCLE_DOM_DIAGNOSTIC/);
  assert.match(source, /MAX_PAYLOAD_BYTES/);
  assert.match(source, /createHash\("sha256"\)/);
  assert.match(source, /commerce_operation_runs/);
  assert.match(source, /ignoreDuplicates: true/);
  assert.match(source, /readOnly: true/);
  assert.doesNotMatch(source, /password|cookie/i);
});

test("lifecycle queue bridge stays fail-closed to non-shadow pending rows", async () => {
  const source = await readFile(lifecycleBridgeRoutePath, "utf8");
  assert.match(source, /\.eq\("status", "pending"\)/);
  assert.match(source, /\.eq\("shadow_mode", false\)/);
  assert.match(source, /claim_run_id/);
  assert.match(source, /confirm_needed/);
});

test("orange one-button content still uses exact ptn_goods_cd and durable submit lock", async () => {
  const source = await readFile(pipelineContentPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /신규상품 전체 자동처리/);
  assert.match(source, /setInputValue\(searchInput, context\.ptnGoodsCd\)/);
  assert.match(source, /matchingRows\.length !== 1/);
  assert.doesNotMatch(source, /setInputValue\(searchInput, context\.searchCode\)/);
  assert.match(source, /PIPE_MARKET_ARM_SUBMIT_MESSAGE/);
  const armIndex = source.indexOf("PIPE_MARKET_ARM_SUBMIT_MESSAGE");
  const clickIndex = source.indexOf("clickElement(sendButton)");
  assert.ok(armIndex >= 0 && clickIndex > armIndex);
});

test("orange frame UI ignores purple title progress unless its own pipeline title stage is running", async () => {
  const source = await readFile(frameBridgePath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /TITLE_BATCH_PROGRESS_MESSAGE/);
  assert.match(source, /const uiRun = await loadUiRun\(\)/);
  assert.match(source, /uiRun\.stage !== "title"/);
  assert.match(source, /uiRun\.stage = "market"/);
  assert.match(source, /신규상품 전체 자동처리 · 동시 2창/);
});

test("v0.5.4 stability bridge recovers completed title work into market start without focus dependency", async () => {
  const source = await readFile(stabilityBridgePath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /TITLE_LAST_RUN_KEY/);
  assert.match(source, /MARKET_LAST_RUN_KEY/);
  assert.match(source, /PIPE_MARKET_START_MESSAGE/);
  assert.match(source, /titleRunCoversUiRun/);
  assert.match(source, /marketEnsured/);
  assert.match(source, /setInterval\(\(\) => void ensureTitleToMarketHandoff/);
  assert.match(source, /window\.addEventListener\("focus"/);
  assert.match(source, /document\.addEventListener\("visibilitychange"/);
  assert.match(source, /outcome: "title_failed"/);
  assert.doesNotMatch(source, /password|document\.cookie/i);
});

test("title worker retains retry verification and itemResults used for durable reporting", async () => {
  const source = await readFile(titleBackgroundPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /const PAGE_TIMEOUT_MS = 60000/);
  assert.match(source, /const MAX_AUTO_RETRIES = 2/);
  assert.match(source, /save_verify_duplicate/);
  assert.match(source, /itemResults/);
  assert.match(source, /LAST_RUN_STORAGE_KEY/);
});

test("title ledger migration baselines all pre-upgrade goods keys and only future rows can queue", async () => {
  const source = await readFile(titleLedgerMigrationPath, "utf8");
  assert.match(source, /shopling_title_diversification_ledger/);
  assert.match(source, /primary key \(owner_id, goods_key\)/i);
  assert.match(source, /baseline_processed/);
  assert.match(source, /v053_cutover_existing_registry/);
  assert.match(source, /on conflict \(owner_id, goods_key\) do nothing/i);
  assert.match(source, /claim_shopling_title_diversification_tasks/);
  assert.match(source, /status = 'confirm_needed'/);
  assert.doesNotMatch(
    source,
    /set status = 'queued',[\s\S]{0,500}where status = 'claimed'[\s\S]{0,120}claimed_at < now\(\) - interval '2 hours'/i,
  );
  assert.match(source, /retry_shopling_title_diversification_failures/);
  assert.match(source, /status in \('failed','confirm_needed'\)/);
  assert.match(source, /grant execute .* service_role/i);
});

test("market pipeline duplicate protections remain unchanged and claim response recovers by run id", async () => {
  const background = await readFile(pipelineBackgroundPath, "utf8");
  const route = await readFile(pipelineRoutePath, "utf8");
  const migration = await readFile(pipelineMigrationPath, "utf8");
  assert.match(background, /PIPE_MAX_LANES = 2/);
  assert.match(background, /!\["submit-armed", "submitted"\]\.includes\(stage\)/);
  assert.match(route, /arm_shopling_market_pipeline_submit/);
  assert.match(route, /\.from\("shopling_market_pipeline_ledger"\)/);
  assert.match(route, /\.eq\("claim_run_id", runId\)/);
  assert.match(route, /\.eq\("status", "claimed"\)/);
  assert.match(route, /recoveredClaimRowCount/);
  assert.match(route, /claim_payload_invalid/);
  assert.match(migration, /legacy_ignored/);
  assert.match(migration, /market_status = 'submit_armed'/);
  assert.match(migration, /stale_claim_requires_review/);
});

test("Shopling downloadable v0.5.6 ZIP contains lifecycle diagnostics plus existing safety workers", async () => {
  const source = await readFile(downloadRoutePath, "utf8");
  assert.ok(source.includes('"content-shopling-product-list-registry-bridge.js"'));
  assert.ok(source.includes('"content-shopling-lifecycle-diagnostic.js"'));
  assert.ok(source.includes('"background-shopling-lifecycle.js"'));
  assert.ok(source.includes('"content-shopling-pipeline-frame-bridge.js"'));
  assert.ok(source.includes('"content-shopling-onebutton-stability-v054.js"'));
  assert.ok(source.includes('"background-shopling-pipeline.js"'));
  assert.ok(source.includes('manifest.version = "0.5.6"'));
  assert.ok(source.includes("commerce-os-shopling-account-title-bridge-v0.5.6.zip"));
  assert.ok(source.includes("Commerce OS Shopling Account Title Bridge v0.5.6"));
  assert.ok(source.includes("상품 생애주기 판매상태 자동화"));
});
