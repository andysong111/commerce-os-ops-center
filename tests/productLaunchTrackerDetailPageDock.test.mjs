import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { moduleRegistry } from "../src/lib/moduleRegistry.ts";
import { OPS_WORKSPACE_GROUPS } from "../src/lib/opsWorkspace.ts";
import {
  createDetailPageJobToken,
  verifyDetailPageJobToken,
} from "../src/lib/detailPageJobToken.ts";

const dockSource = await readFile(
  new URL("../public/product-launch-tracker-app/detail-page-dock.js", import.meta.url),
  "utf8",
);
const appShell = await readFile(
  new URL("../src/components/AppShell.tsx", import.meta.url),
  "utf8",
);
const workAssistant = await readFile(
  new URL("../src/components/OpsWorkAssistant.tsx", import.meta.url),
  "utf8",
);
const trackerPage = await readFile(
  new URL("../src/app/product-launch-tracker/page.tsx", import.meta.url),
  "utf8",
);
const nextConfig = await readFile(
  new URL("../next.config.ts", import.meta.url),
  "utf8",
);
const trackerEntry = await readFile(
  new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
  "utf8",
);
const trackerCore = await readFile(
  new URL("../public/product-launch-tracker-app/lib/tracker-core.mjs", import.meta.url),
  "utf8",
);
const assetRoute = await readFile(
  new URL("../src/app/api/product-launch-tracker/detail-page-assets/route.ts", import.meta.url),
  "utf8",
);
const configRoute = await readFile(
  new URL("../src/app/api/product-launch-tracker/detail-page-engine-config/route.ts", import.meta.url),
  "utf8",
);
const jobsRoute = await readFile(
  new URL("../src/app/api/product-launch-tracker/detail-page-jobs/route.ts", import.meta.url),
  "utf8",
);
const jobRoute = await readFile(
  new URL("../src/app/api/product-launch-tracker/detail-page-jobs/[jobId]/route.ts", import.meta.url),
  "utf8",
);
const startRoute = await readFile(
  new URL("../src/app/api/product-launch-tracker/detail-page-jobs/[jobId]/start/route.ts", import.meta.url),
  "utf8",
);
const studioConnection = await readFile(
  new URL("../src/lib/detailPageStudioConnection.ts", import.meta.url),
  "utf8",
);
const jobServer = await readFile(
  new URL("../src/lib/detailPageJobServer.ts", import.meta.url),
  "utf8",
);
const jobToken = await readFile(
  new URL("../src/lib/detailPageJobToken.ts", import.meta.url),
  "utf8",
);
const recoveryCron = await readFile(
  new URL("../src/app/api/cron/detail-page-jobs/route.ts", import.meta.url),
  "utf8",
);

test("Detail Page Studio is exposed as separate SaaS and internal launch cards", () => {
  const saas = moduleRegistry.find((module) => module.id === "detail-page-studio");
  const internal = moduleRegistry.find(
    (module) => module.id === "detail-page-studio-launch-connector",
  );
  assert.equal(saas?.title, "Commerce OS Detail Page Studio · SaaS 전용");
  assert.equal(saas?.route, "https://commerce-os-detail-page-studio.vercel.app/");
  assert.equal(
    internal?.title,
    "Commerce OS Detail Page Studio · 내부 상품출시진행관리 연결본",
  );
  assert.equal(internal?.route, "/product-launch-tracker?detailPageDock=1");
  assert.ok(
    OPS_WORKSPACE_GROUPS.find((group) => group.id === "product-launch")?.moduleIds.includes(
      "detail-page-studio-launch-connector",
    ),
  );
});

test("selected launch rows run from the detail-purpose China link and expose background progress controls", () => {
  assert.match(trackerEntry, /detail-page-dock\.js/);
  assert.match(dockSource, /선택 상세페이지 생성/);
  assert.match(dockSource, /sourceUrl: readChinaDetailPageLink\(item\)/);
  assert.match(dockSource, /const sourceUrl = readChinaDetailPageLink\(latestItem\)/);
  assert.match(dockSource, /ops_dock/);
  assert.match(dockSource, /source_url/);
  assert.match(dockSource, /detail-page-dock-monitor/);
  assert.match(dockSource, /실패 작업 다시 생성/);
  assert.match(dockSource, /data-retry-item/);
  assert.match(dockSource, /event\.source !== activeFrame\.contentWindow/);
  assert.match(dockSource, /event\.origin !== engineConfig\.engineOrigin/);
  assert.match(dockSource, /LOCAL_BRIDGE_HEALTH_URL/);
  assert.match(dockSource, /ensureDetailPageDependencies/);
  assert.match(dockSource, /FRAME_HANDSHAKE_TIMEOUT_MS = 20 \* 1000/);
  assert.match(dockSource, /payload\.type === "ops-dock-ready"/);
  assert.match(dockSource, /studio_connection/);
});

test("detail page dependency checks stay visible and always restore the selection button", () => {
  assert.match(dockSource, /enqueueing = true;\s+enqueuePhase = "checking";\s+syncRunButton\(\);/);
  assert.match(dockSource, /연결 확인 중…/);
  assert.match(dockSource, /enqueuePhase = "registering";\s+syncRunButton\(\);/);
  assert.match(dockSource, /작업 등록 중…/);
  assert.match(
    dockSource,
    /finally \{\s+enqueueing = false;\s+enqueuePhase = "idle";\s+syncRunButton\(\);\s+\}/,
  );
  assert.match(dockSource, /toast\.hidden = false/);
  assert.match(dockSource, /toast\.hidden = true/);
  assert.match(
    dockSource,
    /!\["success", "failed", "cancelled"\]\.includes\(job\.status\)/,
  );
  assert.match(dockSource, /announceServerJob\(created\)/);
  assert.match(dockSource, /상세페이지 작업 \$\{createdCount\}건 등록 완료/);
  assert.match(dockSource, /이미 진행 중입니다\. 작업도우미에서 현재 상태를 확인하세요/);
  assert.match(dockSource, /showMessage\([\s\S]*15_000/);
  assert.match(dockSource, /detail-page-dock-run-status/);
  assert.match(dockSource, /클릭 확인 · 선택 상품과 연결 상태를 확인하고 있습니다/);
  assert.match(dockSource, /상품 목록 상태를 읽지 못했습니다/);
  assert.match(dockSource, /선택 상태와 상품 데이터가 일치하지 않습니다/);
  assert.match(dockSource, /작업이 등록되지 않았습니다/);
  assert.match(dockSource, /showRunStatus\(message, "error"\)/);
});

test("Chrome local network permission is delegated through both nested detail-page frames", () => {
  assert.match(trackerPage, /allow="local-network; loopback-network; local-network-access"/);
  assert.match(
    dockSource,
    /activeFrame\.allow = "local-network; loopback-network; local-network-access"/,
  );
  assert.match(dockSource, /targetAddressSpace: "loopback"/);
  assert.match(dockSource, /Chrome 주소창 왼쪽 사이트 설정/);
  assert.match(dockSource, /seungjun-ops-bridge:\/\/start/);
  assert.match(dockSource, /waitForLocalCollectorReady/);
  assert.match(dockSource, /수집기를 자동 실행하고 약 12초 동안 다시 연결합니다/);
  assert.doesNotMatch(dockSource, /targetAddressSpace: "loopback"/);
  assert.match(nextConfig, /Permissions-Policy/);
  assert.match(nextConfig, /local-network=/);
  assert.match(nextConfig, /loopback-network=/);
  assert.match(nextConfig, /commerce-os-detail-page-studio-git-agent-ops-l-6edf36-a2bsangsa/);
});

test("OPS origin relays only the evidence collector routes for the hidden Studio frame", () => {
  assert.match(dockSource, /payload\.type === "ops-dock-local-bridge-request"/);
  assert.match(dockSource, /path === "\/runs\/evidence-link"/);
  assert.match(dockSource, /evidence-images/);
  assert.match(dockSource, /ops-dock-local-bridge-response/);
  assert.match(dockSource, /postMessage\(message, targetOrigin, \[body\]\)/);
  assert.match(dockSource, /body\.length > LOCAL_BRIDGE_RELAY_BODY_LIMIT/);
  assert.match(dockSource, /targetAddressSpace: "loopback"/);
  assert.doesNotMatch(dockSource, /LOCAL_BRIDGE_BASE_URL\}\$\{path\}`[\s\S]*credentials: "include"/);
});

test("approved detail, main, and four supplemental assets dock to tracker fields", () => {
  assert.match(jobRoute, /const detailImageUrl = safeText\(body\.detailImageUrl/);
  assert.match(jobRoute, /const mainImageUrl = safeText\(body\.mainImageUrl/);
  assert.match(jobRoute, /stringList\(body\.additionalImageUrls, 4\)/);
  assert.match(jobRoute, /action === "final_complete"/);
  assert.match(jobRoute, /!workerAuthorized && !ownerAuthorized/);
  assert.match(jobRoute, /finalizerMode: workerAuthorized \? "server-v1"/);
  assert.match(dockSource, /const detailHtml = buildDetailHtml/);
  assert.match(dockSource, /detailImageUrl,/);
  assert.match(dockSource, /mainImageUrl,/);
  assert.match(dockSource, /additionalImageUrls,/);
  assert.match(dockSource, /currentAsset\.syncedAt === now/);
  assert.match(dockSource, /sameStringList\(currentAsset\.additionalImageUrls, additionalImageUrls\)/);
  assert.match(dockSource, /html: detailHtml/);
  assert.match(trackerCore, /detailPageAutomation/);
  assert.match(trackerCore, /detailImageUrl/);
});

test("asset docking APIs enforce same-origin, roles, JPG, size, and public stable storage", () => {
  assert.match(assetRoute, /isSameOriginOpsRequest/);
  assert.match(assetRoute, /detail-page\|main\|additional-\[1-4\]/);
  assert.match(assetRoute, /image\\\/jpe\?g/);
  assert.match(assetRoute, /MAX_FILE_BYTES = 4_000_000/);
  assert.match(assetRoute, /product-launch-assets/);
  assert.match(assetRoute, /storage\/v1\/object\/public/);
  assert.match(assetRoute, /\?v=\$\{randomUUID\(\)\}/);
  assert.match(studioConnection, /DETAIL_PAGE_STUDIO_INTERNAL_URL/);
  assert.match(studioConnection, /commerce-os-detail-page-studio\.vercel\.app/);
  assert.match(configRoute, /isSameOriginOpsRequest/);
  assert.match(configRoute, /probeDetailPageStudio/);
  assert.match(configRoute, /probeProtectedOpsCallback/);
  assert.match(studioConnection, /detail-page-callback-health/);
  assert.match(studioConnection, /OPS_PREVIEW_CALLBACK_PROTECTED/);
  assert.match(
    studioConnection,
    /commerce-os-detail-page-studio-git-agent-ops-l-6edf36-a2bsangsa\.vercel\.app/,
  );
  assert.match(studioConnection, /DETAIL_PAGE_STUDIO_AUTOMATION_BYPASS_SECRET/);
  assert.match(studioConnection, /x-vercel-set-bypass-cookie", "samesitenone"/);
  assert.match(studioConnection, /opsDockVersion !== "server-v1"/);
});

test("interrupted generation is recoverable instead of remaining permanently active", () => {
  assert.match(dockSource, /executionMode: "server-v1"/);
  assert.match(dockSource, /await syncJobs\(\)/);
  assert.match(dockSource, /sourceRunId: job\.sourceRunId/);
  assert.match(dockSource, /job\.status === "render_pending"/);
  assert.match(dockSource, /화면 종료 가능/);
  assert.match(dockSource, /finalizerRetryAt\.set\(renderJob\.jobId, Date\.now\(\) \+ 30_000\)/);
  assert.match(dockSource, /await startWorker\(renderJob\.jobId\)/);
  assert.doesNotMatch(dockSource, /openFinalizer/);
  assert.doesNotMatch(dockSource, /browser_interrupted/);
});

test("OPS-wide work assistant survives route changes and owns the persistent browser worker", () => {
  assert.match(appShell, /OpsWorkAssistant/);
  assert.match(workAssistant, /실시간 작업 도우미/);
  assert.match(workAssistant, /현재 진행 중인 작업/);
  assert.match(workAssistant, /detail_page_mode=worker/);
  assert.match(workAssistant, /POLL_MS = 2_500/);
  assert.match(workAssistant, /visibleJobs\.map/);
  assert.match(workAssistant, /retry-detail-page-job/);
  assert.match(workAssistant, /detail-page-job-created/);
  assert.match(workAssistant, /activate-detail-page-job/);
  assert.match(workAssistant, /setJobs\(\(current\) => \[job, \.\.\.current\.filter/);
  assert.match(workAssistant, /detailPageItem=/);
  assert.match(trackerPage, /detail_page_mode: "client"/);
  assert.match(dockSource, /DETAIL_PAGE_MODE/);
  assert.match(dockSource, /CAN_REGISTER_JOBS/);
  assert.match(dockSource, /CAN_EXECUTE_JOBS/);
  assert.match(dockSource, /startClientSync/);
  assert.match(dockSource, /queueCollectingJobsFromState/);
  assert.match(dockSource, /retryingItems\.has/);
  assert.match(dockSource, /runButton\.disabled = count === 0 \|\| enqueueing/);
  assert.match(dockSource, /markLegacyFailed: synced/);
  assert.match(dockSource, /event\.source !== window\.parent/);
  assert.match(dockSource, /event\.key !== STORAGE_KEY/);
  assert.match(dockSource, /payload\.type === "activate-detail-page-job"/);
  assert.match(dockSource, /jobsById\.set\(job\.jobId, job\)/);
});

test("failed detail-page jobs can be removed from the shared assistant without deleting audit history", () => {
  assert.match(workAssistant, /payload\?\.assistant_hidden_at/);
  assert.match(workAssistant, /job\.status !== "failed"/);
  assert.match(workAssistant, /window\.confirm/);
  assert.match(workAssistant, /action: "dismiss_failed_from_assistant"/);
  assert.match(workAssistant, /상품과 생성 이력은 삭제되지 않습니다/);
  assert.match(workAssistant, /removing \? "삭제 중…" : "삭제"/);
  assert.match(jobRoute, /action === "dismiss_failed_from_assistant"/);
  assert.match(jobRoute, /job\.status !== "failed"/);
  assert.match(jobRoute, /assistant_hidden_at: hiddenAt/);
  assert.match(jobRoute, /본인의 실패 작업만 삭제/);
});

test("checkpointed server-generation failures resume without recollecting or discarding approved assets", () => {
  assert.match(dockSource, /isCheckpointedGenerationFailure/);
  assert.match(dockSource, /action: "resume_checkpointed_generation"/);
  assert.match(dockSource, /기존 승인 자산 유지/);
  assert.match(dockSource, /await startWorker\(resumed\.jobId\)/);
  assert.ok(
    dockSource.indexOf("if (checkpointed)") <
      dockSource.indexOf("const sourceUrl = readChinaDetailPageLink(latestItem);", dockSource.indexOf("async function retryItem")),
  );
  assert.match(workAssistant, /canResumeCheckpoint/);
  assert.match(workAssistant, /"이어서 생성"/);
  assert.match(jobRoute, /action === "resume_checkpointed_generation"/);
  assert.match(jobRoute, /job\.stage !== "server_generation"/);
  assert.match(jobRoute, /setAssessment: null/);
  assert.match(jobRoute, /setRetryUsed: false/);
  assert.match(jobRoute, /completed_at: null/);
  assert.match(jobServer, /completedAtProvided/);
});

test("durable jobs reuse the deployed job ledger and require a signed per-job worker token", () => {
  assert.match(jobServer, /product_launch_upload_jobs/);
  assert.match(jobServer, /payload\.kind/);
  assert.match(jobToken, /createHmac\("sha256"/);
  assert.match(jobsRoute, /request_id: `detail-page:/);
  assert.match(jobRoute, /verifyDetailPageJobToken/);
  assert.match(jobRoute, /action === "claim"/);
  assert.match(jobRoute, /action === "evidence_ready"/);
  assert.match(jobRoute, /action === "final_complete"/);
  assert.match(jobRoute, /\["progress", "server_finalizer_progress"\]\.includes\(action\)/);
  assert.doesNotMatch(jobRoute, /workerToken:/);
  assert.match(studioConnection, /\/api\/internal\/ops-detail-page-job/);
  assert.match(startRoute, /resolveDetailPageStudioConnection/);
  assert.match(startRoute, /buildProtectedOpsCallbackUrl/);
  assert.match(startRoute, /redirect: "manual"/);
  const config = { supabaseUrl: "https://example.supabase.co", secretKey: "test-secret" };
  const token = createDetailPageJobToken(
    config,
    "0c23a96b-1cda-44b6-9c08-1fa1c1b45a36",
    "00112233-4455-4677-8899-aabbccddeeff",
  );
  assert.equal(token.length, 64);
  assert.equal(
    verifyDetailPageJobToken(
      config,
      "0c23a96b-1cda-44b6-9c08-1fa1c1b45a36",
      "00112233-4455-4677-8899-aabbccddeeff",
      token,
    ),
    true,
  );
  assert.equal(
    verifyDetailPageJobToken(
      config,
      "0c23a96b-1cda-44b6-9c08-1fa1c1b45a36",
      "00112233-4455-4677-8899-aabbccddeeff",
      "0".repeat(64),
    ),
    false,
  );
});

test("stalled server generation is restarted by the production watchdog", () => {
  assert.match(recoveryCron, /RECOVERY_AFTER_MS = 8 \* 60 \* 1000/);
  assert.match(recoveryCron, /listRecoverableDetailPageJobs/);
  assert.match(recoveryCron, /CRON_SECRET/);
  assert.match(recoveryCron, /createDetailPageJobToken/);
});
