import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  "src/lib/productDecisionLiveRefresh.ts",
  "utf8",
);
const shoplingClient = await readFile(
  "src/lib/shopling/shoplingReadClient.ts",
  "utf8",
);
const shoplingTransport = await readFile(
  "src/lib/shopling/shoplingTlsTransport.ts",
  "utf8",
);
const api = await readFile(
  "src/app/api/product-decision-agent/live-refresh/route.ts",
  "utf8",
);
const cron = await readFile(
  "src/app/api/cron/product-decision-live-refresh/route.ts",
  "utf8",
);
const page = await readFile(
  "src/app/product-decision-agent/live-refresh/page.tsx",
  "utf8",
);
const control = await readFile(
  "src/app/product-decision-agent/live-refresh/LiveRefreshControl.tsx",
  "utf8",
);
const scheduler = await readFile(
  "supabase/migrations/202608280009_ops_adaptive_dispatcher.sql",
  "utf8",
);

test("live refresh stores immutable request, chunk, failure and final operation types", () => {
  for (const operation of [
    "PRODUCT_DECISION_LIVE_REFRESH_REQUEST",
    "PRODUCT_DECISION_LIVE_ORDER_CHUNK",
    "PRODUCT_DECISION_LIVE_CLAIM_CHUNK",
    "PRODUCT_DECISION_LIVE_STEP_FAILURE",
    "PRODUCT_DECISION_LIVE_FAILED",
    "PRODUCT_DECISION_LIVE_SHADOW",
  ]) {
    assert.match(workflow, new RegExp(operation));
  }
  assert.match(workflow, /on_conflict=source_event_id/);
  assert.match(workflow, /resolution=ignore-duplicates/);
  assert.doesNotMatch(workflow, /resolution=merge-duplicates/);
});

test("orders and claims are split into bounded chunks and one step is processed per worker call", () => {
  assert.match(workflow, /splitShoplingDateRange\([\s\S]*?7,/);
  assert.match(workflow, /splitShoplingDateRange\([\s\S]*?90,/);
  assert.match(workflow, /request\.orderRanges\.find/);
  assert.match(workflow, /request\.claimRanges\.find/);
  assert.match(workflow, /executeOrderStep/);
  assert.match(workflow, /executeClaimStep/);
  assert.match(workflow, /MAX_STEP_ATTEMPTS = 3/);
});

test("planning snapshot uses one bounded live read, a recent verified fallback, and is frozen for every chunk", () => {
  assert.match(workflow, /contentFingerprint\?: string/);
  assert.match(workflow, /planningContentFingerprint: string/);
  assert.match(workflow, /planningSnapshot: VersionedProductPlanningSnapshot \| null/);
  assert.match(workflow, /planningSnapshot: planning/);
  assert.match(workflow, /request\.planningSnapshot \?\?/);
  assert.match(workflow, /PRODUCT_MASTER_REFRESH_TIMEOUT_MS = 70_000/);
  assert.match(workflow, /PRODUCT_MASTER_STORED_FALLBACK_MAX_AGE_MS = 72 \* 60 \* 60 \* 1000/);
  assert.match(workflow, /selectRecentStoredPlanningSnapshot/);
  assert.match(workflow, /if \(!retryablePlanningRead\(error\)\) throw error/);
  assert.match(workflow, /\^sha256:\[a-f0-9\]\{64\}\$/);
  assert.match(
    workflow,
    /planning\.contentFingerprint !== request\.planningContentFingerprint/,
  );
  assert.doesNotMatch(
    workflow,
    /planning\.generatedAt !== request\.planningGeneratedAt/,
  );
  assert.match(workflow, /PRODUCT_MASTER_PLANNING_CHANGED/);
  assert.match(
    workflow,
    /planning\.products\.length !== request\.planningProductCount/,
  );
  assert.match(workflow, /planningAttempt >= MAX_STEP_ATTEMPTS/);
  assert.match(workflow, /storeTerminalFailure\(request, planningStageKey/);
});

test("purchase-run status reads only the newest frozen planning snapshot", () => {
  assert.match(
    workflow,
    /loadRecentStoredPlanningSnapshot\(\)[\s\S]*?readOperations\(PRODUCT_DECISION_LIVE_REQUEST, undefined, 1\)/,
  );
  assert.match(
    workflow,
    /latestRequest\(\)[\s\S]*?readOperations\(PRODUCT_DECISION_LIVE_REQUEST, undefined, 1\)/,
  );
  assert.doesNotMatch(
    workflow,
    /readOperations\(PRODUCT_DECISION_LIVE_REQUEST, undefined, (?:10|20)\)/,
  );
});

test("purchase-run freshness follows the latest stored progress instead of its start time", () => {
  assert.match(workflow, /PURCHASE_RUN_ACTIVE_RESUME_MAX_AGE_MS = 30 \* 60 \* 1000/);
  assert.match(workflow, /lastActivityAt\?: string \| null/);
  assert.match(
    workflow,
    /current\.lastActivityAt \?\? current\.analysisAsOf/,
  );
  assert.match(
    workflow,
    /operations\.finals\.map\(\(row\) => iso\(row\.started_at\)\)/,
  );
  assert.match(
    workflow,
    /resumableActive = ageMs >= 0[\s\S]*?current\.state === "QUEUED" \|\| current\.state === "RUNNING"/,
  );
  assert.match(workflow, /freshCompleted = fresh && current\.state === "COMPLETED"/);
  assert.match(workflow, /if \(resumableActive \|\| freshCompleted\)/);
});

test("each Shopling chunk performs one bounded HTTP attempt and worker retries are the only retry layer", () => {
  assert.match(
    shoplingClient,
    /postShoplingXml\(this\.url\(resource\), xml/,
  );
  assert.match(shoplingClient, /timeoutMs: 45_000/);
  assert.match(shoplingTransport, /AbortSignal\.timeout\(timeoutMs\)/);
  assert.match(shoplingTransport, /requestHandle\.setTimeout\(timeoutMs/);
  assert.match(shoplingTransport, /isShoplingWeakDhFailure\(error\)/);
  assert.doesNotMatch(shoplingClient + shoplingTransport, /for \(let attempt/);
  assert.doesNotMatch(shoplingClient + shoplingTransport, /await delay\(/);
  assert.equal((shoplingTransport.match(/await fetch\(url,/g) ?? []).length, 1);
});

test("final live result remains a shadow snapshot and compares against the verified baseline", () => {
  assert.match(workflow, /PRODUCT_DECISION_LIVE_SHADOW/);
  assert.match(workflow, /PRODUCT_DECISION_SNAPSHOT_IMPORT/);
  assert.match(workflow, /compareLiveProductDecision/);
  assert.match(workflow, /resultSnapshot: \{ snapshot, comparison \}/);
  assert.doesNotMatch(workflow, /PRODUCT_DECISION_LIVE_ACTIVE/);
});

test("same-origin operator API creates requests and exposes a manual one-step fallback", () => {
  assert.match(api, /isSameOriginOpsRequest/);
  assert.match(api, /createProductDecisionLiveRefreshRequest/);
  assert.match(api, /action.*run-next/s);
  assert.match(api, /runProductDecisionLiveRefreshStep/);
  assert.match(api, /alreadyActive/);
  assert.match(api, /loadMonthlyPurchaseCycleGate/);
  assert.doesNotMatch(api, /x-commerce-os-integration-secret/);
});

test("cron is bearer protected, bounded, and an operational dispatcher task", () => {
  assert.match(cron, /Bearer \$\{expected\}/);
  assert.match(cron, /productDecisionLiveRefreshConfigured/);
  assert.match(cron, /configured: false/);
  assert.match(
    scheduler,
    /'product-decision-live-refresh', '\/api\/cron\/product-decision-live-refresh', 'operational', 110, true, 3600, 300, 21600/,
  );
});

test("monthly operator UI can be closed while the worker continues and never claims to place orders", () => {
  assert.match(page, /월간 발주안 계산/);
  assert.match(
    page,
    /실제 1688 주문·결제·중국 전송·재고변경은 이 계산 화면에서 실행하지 않습니다/,
  );
  assert.match(control, /화면을 닫아도 예약 Worker/);
  assert.match(control, /실제 주문 쓰기 차단/);
  assert.match(control, /발주안 만들기/);
  assert.match(control, /월 1회/);
});

test("workflow has no Shopling write, inventory mutation or actual order path", () => {
  assert.doesNotMatch(workflow, /shopling.*(?:update|modify|write)/i);
  assert.doesNotMatch(workflow, /1688/i);
  assert.doesNotMatch(workflow, /inventory.*(?:update|write)/i);
  assert.doesNotMatch(
    workflow,
    /method:\s*"PUT"|method:\s*"PATCH"|method:\s*"DELETE"/,
  );
});
