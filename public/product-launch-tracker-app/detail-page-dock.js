import { buildDetailHtml } from "./lib/detail-page-html.mjs";
import { readChinaDetailPageLink } from "./lib/china-product-links.mjs";

const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const OPTIMIZED_TRACKER_API = "/api/product-launch-tracker/optimized";
const ENGINE_CONFIG_API = "/api/product-launch-tracker/detail-page-engine-config";
const ASSET_UPLOAD_API = "/api/product-launch-tracker/detail-page-assets";
const JOBS_API = "/api/product-launch-tracker/detail-page-jobs";
const MESSAGE_SOURCE = "commerce-os-detail-page-studio";
const WORK_ASSISTANT_SOURCE = "commerce-os-work-assistant";
const DOCK_EVENT_SOURCE = "commerce-os-detail-page-dock";
const FRAME_TIMEOUT_MS = 15 * 60 * 1000;
const FRAME_HANDSHAKE_TIMEOUT_MS = 20 * 1000;
const LOCAL_BRIDGE_HEALTH_URL = "http://127.0.0.1:8765/health";
const LOCAL_BRIDGE_BASE_URL = "http://127.0.0.1:8765";
const LOCAL_BRIDGE_TIMEOUT_MS = 5 * 1000;
const LOCAL_BRIDGE_RELAY_BODY_LIMIT = 16 * 1024;
const LOCAL_BRIDGE_START_PROTOCOL = "seungjun-ops-bridge://start";
const LOCAL_BRIDGE_START_WAIT_MS = 12 * 1000;
const LOCAL_BRIDGE_RETRY_INTERVAL_MS = 1000;
const POLL_INTERVAL_MS = 2500;
const STALE_WORKER_MS = 8 * 60 * 1000;
const PAGE_PARAMS = new URLSearchParams(window.location.search);
const DETAIL_PAGE_MODE = PAGE_PARAMS.get("detail_page_mode") || "standalone";
const COMPILER_WORKER_SLOT_RAW = PAGE_PARAMS.get("compiler_worker_slot");
const COMPILER_WORKER_SLOTS = Math.max(
  1,
  Math.min(6, Math.floor(Number(PAGE_PARAMS.get("compiler_worker_slots")) || 3)),
);
const COMPILER_WORKER_SLOT = COMPILER_WORKER_SLOT_RAW === null
  ? 0
  : Math.max(
      0,
      Math.min(
        COMPILER_WORKER_SLOTS - 1,
        Math.floor(Number(COMPILER_WORKER_SLOT_RAW) || 0),
      ),
    );
const COMPILER_WORKER_EXPLICIT = COMPILER_WORKER_SLOT_RAW !== null;
const CAN_REGISTER_JOBS = DETAIL_PAGE_MODE !== "worker";
const CAN_EXECUTE_JOBS = DETAIL_PAGE_MODE !== "client";
const SHOW_LOCAL_MONITOR = DETAIL_PAGE_MODE === "standalone";
const REQUESTED_ITEM_ID = cleanText(PAGE_PARAMS.get("open_item"), 160);

const bulkControls = document.querySelector(".bulk-controls");
const tableBody = document.querySelector("#launch-table-body");
let runButton = null;
let runStatus = null;
let monitor = null;
let queue = [];
let active = null;
let activeFrame = null;
let activeTimer = null;
let activeHandshakeTimer = null;
let engineConfig = null;
let syncing = false;
let enqueueing = false;
let enqueuePhase = "idle";
let messageTimer = null;
let runStatusTimer = null;
const jobsById = new Map();
const workerResumeAt = new Map();
const finalizerRetryAt = new Map();
const retryingItems = new Set();

function compilerWorkerSlotForItem(itemId) {
  const value = String(itemId ?? "").trim();
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % COMPILER_WORKER_SLOTS;
}

function persistedCompilerWorkerSlot(job) {
  const value = Number(job?.payload?.compiler_worker_slot);
  return Number.isInteger(value) && value >= 0 && value < COMPILER_WORKER_SLOTS
    ? value
    : null;
}

function isCompilerJob(job) {
  return job?.payload?.compiler_canary === true;
}

function workerOwnsJob(job) {
  if (DETAIL_PAGE_MODE !== "worker") return true;
  if (!isCompilerJob(job)) return !COMPILER_WORKER_EXPLICIT;
  const persistedSlot = persistedCompilerWorkerSlot(job);
  return (persistedSlot ?? compilerWorkerSlotForItem(job?.itemId)) === COMPILER_WORKER_SLOT;
}

installStyles();
if (CAN_REGISTER_JOBS) installControls();
if (CAN_EXECUTE_JOBS) {
  void restoreMonitor();
  window.addEventListener("message", (event) => void handleEngineMessage(event));
} else {
  void startClientSync();
}
if (DETAIL_PAGE_MODE === "worker") {
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== window.location.origin) return;
    const payload = event.data;
    if (payload?.source !== WORK_ASSISTANT_SOURCE) return;
    if (payload.type === "retry-detail-page-job") {
      const itemId = cleanText(payload.itemId, 160);
      if (itemId) void retryItem(itemId, {
        requestedJobId: cleanText(payload.jobId, 160),
        mode: payload.mode === "full" ? "full" : payload.mode === "resume" ? "resume" : "auto",
        requestId: cleanText(payload.requestId, 160),
      });
    }
    if (payload.type === "activate-detail-page-job") {
      const job = payload.job;
      const requestId = cleanText(payload.requestId, 160);
      if (!job || !isValidJobId(job.jobId) || !cleanText(job.itemId, 160)) {
        announceFinalizerStatus({
          requestId,
          jobId: cleanText(job?.jobId, 160),
          tone: "error",
          phase: "rejected",
          message: "최종 조립 재연결 요청 값이 올바르지 않습니다.",
        });
        return;
      }
      void activateFinalizerJob(job, requestId);
    }
  });
}
window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY) return;
  window.dispatchEvent(new CustomEvent("product-launch-tracker:external-state"));
  if (CAN_EXECUTE_JOBS) {
    queueCollectingJobsFromState();
    void processNext();
  }
});
if (CAN_REGISTER_JOBS && REQUESTED_ITEM_ID) {
  window.setTimeout(() => openRequestedItem(REQUESTED_ITEM_ID), 250);
}

if (tableBody) {
  new MutationObserver(syncRunButton).observe(tableBody, {
    childList: true,
    subtree: true,
  });
}
document.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;
  if (target.id === "select-visible" || target.closest("#launch-table-body")) {
    window.setTimeout(syncRunButton, 0);
  }
}, true);

function installControls() {
  if (!bulkControls || bulkControls.querySelector("#detail-page-dock-run-button")) return;
  runButton = document.createElement("button");
  runButton.id = "detail-page-dock-run-button";
  runButton.type = "button";
  runButton.className = "button button-primary";
  runButton.title = "체크한 상품을 서버 작업으로 등록합니다. 화면을 닫아도 AI 생성은 계속됩니다.";
  runButton.addEventListener("click", () => {
    void enqueueSelected().catch((error) => {
      const message = error instanceof Error
        ? error.message
        : "상세페이지 생성 요청을 처리하지 못했습니다.";
      showRunStatus(message, "error");
      showMessage(message, 15_000);
    });
  });
  runStatus = document.createElement("p");
  runStatus.id = "detail-page-dock-run-status";
  runStatus.className = "detail-page-dock-run-status";
  runStatus.setAttribute("role", "status");
  runStatus.setAttribute("aria-live", "polite");
  runStatus.hidden = true;
  const clear = bulkControls.querySelector("#clear-selection-button");
  if (clear) {
    clear.before(runButton);
    runButton.after(runStatus);
  } else bulkControls.append(runButton, runStatus);
  syncRunButton();
}

function syncRunButton() {
  if (!runButton) return;
  const count = selectedRowIds().length;
  runButton.disabled = count === 0 || enqueueing;
  if (enqueueing) {
    runButton.textContent = enqueuePhase === "registering"
      ? `작업 등록 중… (${count}건)`
      : `연결 확인 중… (${count}건)`;
    return;
  }
  runButton.textContent = count
    ? `선택 상세페이지 생성 (${count}건)`
    : "선택 상세페이지 생성";
}

async function enqueueSelected() {
  if (enqueueing) return;
  enqueueing = true;
  enqueuePhase = "checking";
  syncRunButton();
  showRunStatus("클릭 확인 · 선택 상품과 연결 상태를 확인하고 있습니다.", "progress");

  const selectedIds = selectedRowIds();
  try {
    if (!selectedIds.length) {
      const message = "선택된 상품이 없습니다. 상품 왼쪽 체크박스를 다시 선택하세요.";
      showRunStatus(message, "error");
      showMessage(message, 10_000);
      return;
    }

    const state = readState();
    if (!Array.isArray(state?.items)) {
      const message = "상품 목록 상태를 읽지 못했습니다. Ctrl+F5 후 다시 시도하세요.";
      showRunStatus(message, "error");
      showMessage(message, 15_000);
      return;
    }
    const selected = await loadAuthoritativeSelectedItems(state, selectedIds);
    const invalid = selected.filter((item) => !readChinaDetailPageLink(item));
    if (invalid.length) {
      const message = `${invalid.map((item) => item.modelNumber || item.productName || item.id).join(", ")} 상품에 상세페이지 제작용 1688 링크가 없습니다. 상품 상세에서 제작용 또는 공통 링크를 입력하세요.`;
      showRunStatus(message, "error");
      showMessage(message, 15_000);
      return;
    }

    showRunStatus(
      "Chrome 로컬 네트워크 권한·로컬 수집기·Studio 연결을 확인하고 있습니다.",
      "progress",
    );
    try {
      await ensureDetailPageDependencies();
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "상세페이지 생성 연결을 확인하지 못했습니다.";
      showRunStatus(message, "error");
      showMessage(message, 15_000);
      return;
    }
    showRunStatus("연결 확인 완료 · 생성 여부 확인창을 열었습니다.", "success");
    if (!window.confirm(
      `선택한 ${selected.length}개 상품의 상세페이지·대표 1장·부가 4장을 생성할까요? 1688 수집이 끝난 뒤에는 창을 닫거나 새로고침해도 서버에서 계속 생성됩니다.`,
    )) {
      showRunStatus("사용자가 생성을 취소했습니다. 비용은 발생하지 않았습니다.", "neutral", 8_000);
      return;
    }

    enqueuePhase = "registering";
    syncRunButton();
    showRunStatus("확인 완료 · 서버 작업을 등록하고 작업도우미에 연결하고 있습니다.", "progress");
    if (SHOW_LOCAL_MONITOR) ensureMonitor();
    let createdCount = 0;
    let existingCount = 0;
    const existingItems = new Set(
      [...jobsById.values()]
        .filter((job) => !["success", "failed", "cancelled"].includes(job.status))
        .map((job) => job.itemId),
    );
    for (const item of selected) {
      const itemId = String(item.id);
      if (existingItems.has(itemId) || queue.some((job) => job.itemId === itemId) || active?.itemId === itemId) {
        existingCount += 1;
        continue;
      }
      const job = {
        itemId,
        jobId: crypto.randomUUID(),
        sourceUrl: readChinaDetailPageLink(item),
        productName: String(item.productName || item.modelNumber || "상품"),
        salesOptions: readSalesOptions(item),
        attempt: Number(item.detailPageAutomation?.attempt || 0) + 1,
        sourceRunId: "",
      };
      try {
        const created = await createServerJob(job);
        jobsById.set(job.jobId, created);
        queue.push(job);
        patchItem(itemId, {
          detailPageAutomation: {
            jobId: job.jobId,
            status: "queued",
            stage: "source_collection",
            message: "1688 상품정보·이미지 수집 대기 중",
            progress: 1,
            qaStatus: "pending",
            sourceUrl: job.sourceUrl,
            sourceRunId: "",
            attempt: job.attempt,
            queuedAt: new Date().toISOString(),
            startedAt: null,
            completedAt: null,
            error: "",
            executionMode: "server-v1",
          },
        });
        existingItems.add(itemId);
        createdCount += 1;
        announceServerJob(created);
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : "상세페이지 서버 작업을 등록하지 못했습니다.";
        showRunStatus(message, "error");
        showMessage(message, 15_000);
        break;
      }
    }
    renderMonitor();
    if (CAN_EXECUTE_JOBS) void processNext();
    if (createdCount) {
      const message = `상세페이지 작업 ${createdCount}건 등록 완료 · 작업도우미에서 진행 상태를 확인하세요.${existingCount ? ` 이미 진행 중 ${existingCount}건은 중복 등록하지 않았습니다.` : ""}`;
      showRunStatus(message, "success", 15_000);
      showMessage(message, 8_000);
    } else if (existingCount) {
      const message = `선택한 ${existingCount}건은 이미 진행 중입니다. 작업도우미에서 현재 상태를 확인하세요.`;
      showRunStatus(message, "neutral", 15_000);
      showMessage(message, 10_000);
    } else {
      const message = "작업이 등록되지 않았습니다. 표시된 오류를 확인한 뒤 다시 시도하세요.";
      showRunStatus(message, "error");
      showMessage(message, 15_000);
    }
  } catch (error) {
    const message = error instanceof Error
      ? `상세페이지 생성 요청 오류: ${error.message}`
      : "상세페이지 생성 요청 중 알 수 없는 오류가 발생했습니다.";
    showRunStatus(message, "error");
    showMessage(message, 15_000);
  } finally {
    enqueueing = false;
    enqueuePhase = "idle";
    syncRunButton();
  }
}

async function createServerJob(job) {
  const response = await fetch(JOBS_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(job),
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true || !payload.job) {
    throw new Error(payload.message || "상세페이지 서버 작업을 만들지 못했습니다.");
  }
  return payload.job;
}

function announceServerJob(job) {
  if (!job || !isValidJobId(job.jobId)) return;
  window.parent?.postMessage(
    {
      source: DOCK_EVENT_SOURCE,
      type: "detail-page-job-created",
      job,
    },
    window.location.origin,
  );
}

function announceFinalizerStatus({
  requestId = "",
  jobId = "",
  tone = "progress",
  phase = "",
  message = "",
  job = null,
}) {
  window.parent?.postMessage(
    {
      source: DOCK_EVENT_SOURCE,
      type: "detail-page-finalizer-status",
      requestId,
      jobId,
      tone,
      phase,
      message,
      job,
    },
    window.location.origin,
  );
}

async function activateFinalizerJob(job, requestId) {
  jobsById.set(job.jobId, job);
  announceFinalizerStatus({
    requestId,
    jobId: job.jobId,
    tone: "progress",
    phase: "received",
    message: "서버 최종 조립 재시작 요청을 확인했습니다.",
    job,
  });
  try {
    finalizerRetryAt.set(job.jobId, Date.now() + 30_000);
    await startWorker(job.jobId);
    announceFinalizerStatus({
      requestId,
      jobId: job.jobId,
      tone: "success",
      phase: "accepted",
      message: "저장된 검수 통과 자산으로 서버 최종 조립을 시작했습니다.",
      job,
    });
  } catch (error) {
    finalizerRetryAt.set(job.jobId, Date.now() + 30_000);
    announceFinalizerStatus({
      requestId,
      jobId: job.jobId,
      tone: "error",
      phase: "start_failed",
      message:
        error instanceof Error
          ? error.message
          : "서버 최종 조립을 시작하지 못했습니다.",
      job,
    });
  }
}

async function processNext() {
  if (active) return;
  const renderJob = [...jobsById.values()].find(
    (job) =>
      workerOwnsJob(job) &&
      job.status === "render_pending" &&
      Date.now() >= (finalizerRetryAt.get(job.jobId) || 0),
  );
  if (renderJob) {
    finalizerRetryAt.set(renderJob.jobId, Date.now() + 30_000);
    await startWorker(renderJob.jobId).catch(() => undefined);
    return;
  }
  while (queue.length) {
    const next = queue.shift();
    const server = jobsById.get(next.jobId);
    if (!server || !workerOwnsJob(server) || server.status !== "collecting") continue;
    await openEvidenceCollector({ ...next, sourceRunId: server.sourceRunId || next.sourceRunId || "" });
    return;
  }
}

async function openEvidenceCollector(job) {
  active = { ...job, mode: "collect" };
  updateAutomation(job.itemId, {
    status: "running",
    stage: "source_collection",
    message: job.sourceRunId
      ? "기존 1688 수집 작업에 다시 연결 중"
      : "1688 상품정보·이미지 수집기 연결 중",
    progress: job.sourceRunId ? 5 : 3,
    qaStatus: "pending",
    sourceRunId: job.sourceRunId,
    startedAt: new Date().toISOString(),
    error: "",
  });
  renderMonitor();
  try {
    const config = await getEngineConfig();
    const url = new URL(config.engineUrl);
    url.searchParams.set("ops_dock", "1");
    url.searchParams.set("execution_mode", "server");
    url.searchParams.set("job_id", job.jobId);
    url.searchParams.set("item_id", job.itemId);
    url.searchParams.set("target_origin", window.location.origin);
    url.searchParams.set("source_url", job.sourceUrl);
    if (job.salesOptions) url.searchParams.set("sales_options", job.salesOptions);
    if (job.sourceRunId) url.searchParams.set("source_run_id", job.sourceRunId);
    mountFrame(url, "1688 근거 수집기");
  } catch (error) {
    await failActive(error instanceof Error ? error.message : "1688 수집기를 열지 못했습니다.", "source_collection");
  }
}

function mountFrame(url, title) {
  activeFrame = document.createElement("iframe");
  activeFrame.id = "detail-page-dock-engine-frame";
  activeFrame.title = title;
  activeFrame.src = url.toString();
  activeFrame.allow = "local-network; loopback-network; local-network-access";
  activeFrame.setAttribute("aria-hidden", "true");
  document.body.append(activeFrame);
  activeHandshakeTimer = window.setTimeout(() => {
    void handleFrameHandshakeTimeout();
  }, FRAME_HANDSHAKE_TIMEOUT_MS);
}

async function handleFrameHandshakeTimeout() {
  if (!active) return;
  await failActive(
    "상세페이지 Studio가 20초 안에 응답하지 않았습니다. Preview 주소 또는 보호 인증을 확인하세요.",
    "studio_connection",
  );
}

async function handleFrameTimeout() {
  if (!active) return;
  await failActive("1688 수집기 연결 시간이 15분을 초과했습니다.", "source_collection");
}

async function handleEngineMessage(event) {
  if (!active || !activeFrame || event.source !== activeFrame.contentWindow) return;
  if (!engineConfig || event.origin !== engineConfig.engineOrigin) return;
  const payload = event.data;
  if (!payload || payload.source !== MESSAGE_SOURCE || payload.jobId !== active.jobId) return;

  markFrameConnected();

  if (payload.type === "ops-dock-local-bridge-request" && active.mode === "collect") {
    await relayLocalBridgeRequest(payload);
    return;
  }

  if (payload.type === "ops-dock-ready") {
    updateAutomation(active.itemId, {
      status: "running",
      stage: "source_collection",
      message: "Studio 연결 완료 · 로컬 수집기 확인 중",
      progress: 5,
      error: "",
    });
    renderMonitor();
    return;
  }

  if (payload.type === "ops-dock-progress") {
    updateAutomation(active.itemId, {
      status: "running",
      stage: cleanText(payload.stage, 80) || "running",
      message: cleanText(payload.message, 240) || "생성 준비 중",
      progress: clamp(Number(payload.progress) || 0, 1, 99),
      qaStatus: payload.qaStatus === "passed" ? "passed" : "pending",
    });
    renderMonitor();
    return;
  }
  if (payload.type === "ops-dock-source-run") {
    const sourceRunId = cleanText(payload.sourceRunId, 200);
    if (!sourceRunId) return;
    active.sourceRunId = sourceRunId;
    updateAutomation(active.itemId, { sourceRunId });
    await updateServerJob(active.jobId, { action: "source_started", sourceRunId });
    return;
  }
  if (payload.type === "ops-dock-evidence-ready") {
    await acceptEvidence(payload);
    return;
  }
  if (payload.type === "ops-dock-failed") {
    await failActive(
      cleanText(payload.message, 500) || "상세페이지 준비 단계에 실패했습니다.",
      cleanText(payload.stage, 80) || "source_collection",
    );
    return;
  }
}

function allowedLocalBridgeRelay(path, method) {
  if (method === "POST") return path === "/runs/evidence-link";
  if (method !== "GET") return false;
  return path === "/health" ||
    /^\/runs\/[A-Za-z0-9_-]+(?:\/result)?$/.test(path) ||
    /^\/runs\/[A-Za-z0-9_-]+\/evidence-images\/[A-Za-z0-9_-]+$/.test(path);
}

function postLocalBridgeRelayResponse(frame, targetOrigin, payload, body) {
  if (!frame?.contentWindow) return;
  const message = {
    source: DOCK_EVENT_SOURCE,
    type: "ops-dock-local-bridge-response",
    ...payload,
  };
  if (body instanceof ArrayBuffer) {
    message.body = body;
    frame.contentWindow.postMessage(message, targetOrigin, [body]);
    return;
  }
  frame.contentWindow.postMessage(message, targetOrigin);
}

async function relayLocalBridgeRequest(payload) {
  const frame = activeFrame;
  const jobId = active?.jobId || "";
  const targetOrigin = engineConfig?.engineOrigin || "";
  const requestId = cleanText(payload.requestId, 100);
  const path = cleanText(payload.path, 500);
  const method = cleanText(payload.method, 10).toUpperCase() || "GET";
  const body = typeof payload.body === "string" ? payload.body : "";
  const contentType = cleanText(payload.contentType, 100);
  const respond = (response, responseBody) => {
    if (activeFrame !== frame || active?.jobId !== jobId) return;
    postLocalBridgeRelayResponse(
      frame,
      targetOrigin,
      { jobId, requestId, ...response },
      responseBody,
    );
  };

  if (
    !requestId ||
    !targetOrigin ||
    !allowedLocalBridgeRelay(path, method) ||
    body.length > LOCAL_BRIDGE_RELAY_BODY_LIMIT ||
    (method === "POST" && contentType !== "application/json") ||
    (method === "GET" && body)
  ) {
    respond({ error: "허용되지 않은 OPS 로컬 수집기 중계 요청입니다." });
    return;
  }

  try {
    const response = await fetch(`${LOCAL_BRIDGE_BASE_URL}${path}`, {
      method,
      cache: "no-store",
      credentials: "omit",
      headers: method === "POST" ? { "Content-Type": "application/json" } : {},
      body: method === "POST" ? body : undefined,
      targetAddressSpace: "loopback",
    });
    const responseBody = await response.arrayBuffer();
    respond(
      {
        status: response.status,
        contentType:
          response.headers.get("Content-Type") || "application/octet-stream",
      },
      responseBody,
    );
  } catch {
    respond({ error: "OPS가 로컬 수집기에 연결하지 못했습니다." });
  }
}

async function acceptEvidence(payload) {
  if (!active || active.mode !== "collect") return;
  const evidence = Array.isArray(payload.evidence) ? payload.evidence.slice(0, 60) : [];
  if (!evidence.length || evidence.some((image) => !image?.base64)) {
    await failActive("Studio가 전달한 1688 근거 이미지가 올바르지 않습니다.", "evidence_checkpoint");
    return;
  }
  try {
    updateAutomation(active.itemId, {
      status: "uploading",
      stage: "evidence_upload",
      message: `1688 근거 이미지 ${evidence.length}장 서버 저장 중`,
      progress: 9,
    });
    const urls = new Array(evidence.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(4, evidence.length) }, async () => {
      while (cursor < evidence.length) {
        const index = cursor;
        cursor += 1;
        urls[index] = await uploadOne(
          active,
          `evidence-${index + 1}`,
          evidence[index],
        );
      }
    });
    await Promise.all(workers);
    await updateServerJob(active.jobId, {
      action: "evidence_ready",
      productName: cleanText(payload.productName, 250) || active.productName,
      sourceProductInfo: cleanMultiline(payload.sourceProductInfo, 8000),
      evidenceUrls: urls,
      evidenceNames: evidence.map((image, index) =>
        cleanText(image.name, 160) || `evidence-${index + 1}.jpg`,
      ),
    });
    const jobId = active.jobId;
    const itemId = active.itemId;
    finishActive();
    updateAutomation(itemId, {
      status: "running",
      stage: "queued",
      message: "서버 생성 대기 중 · 창을 닫아도 계속됩니다.",
      progress: 10,
      qaStatus: "pending",
      error: "",
    });
    try {
      await startWorker(jobId);
      await syncJobs();
    } catch (error) {
      updateAutomation(itemId, {
        status: "running",
        stage: "queued",
        message: "서버 생성 자동 재시작 대기 중 · 근거 이미지는 저장됨",
        error: error instanceof Error ? error.message : "서버 작업을 즉시 시작하지 못했습니다.",
      });
      window.setTimeout(() => void startWorker(jobId).catch(() => undefined), 5000);
    }
  } catch (error) {
    await failActive(
      error instanceof Error ? error.message : "1688 근거 이미지를 서버에 저장하지 못했습니다.",
      "evidence_upload",
    );
  }
}

async function uploadOne(job, role, image) {
  const body = new FormData();
  body.set("item_id", job.itemId);
  body.set("job_id", job.jobId);
  body.set("role", role);
  body.set("file", base64File(image.base64, image.mimeType || "image/jpeg", `${role}.jpg`));
  const response = await fetch(ASSET_UPLOAD_API, {
    method: "POST",
    body,
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true || !payload.publicUrl) {
    throw new Error(payload.message || `작업 이미지 저장에 실패했습니다. (${role})`);
  }
  return payload.publicUrl;
}

async function failActive(message, stage = "failed") {
  if (!active) return;
  const failed = active;
  try {
    await updateServerJob(failed.jobId, {
      action: "source_failed",
      stage,
      error: message,
    });
  } catch {
    // The local monitor still records the error if the durable store is unavailable.
  }
  updateAutomation(failed.itemId, {
    status: "failed",
    stage: stage || "failed",
    message: "생성 실패 · 다시 생성할 수 있습니다.",
    qaStatus: "failed",
    error: message,
    completedAt: new Date().toISOString(),
  });
  finishActive();
}

function finishActive() {
  window.clearTimeout(activeTimer);
  window.clearTimeout(activeHandshakeTimer);
  activeTimer = null;
  activeHandshakeTimer = null;
  activeFrame?.remove();
  activeFrame = null;
  active = null;
  renderMonitor();
  window.setTimeout(() => void processNext(), 250);
}

async function retryItem(itemId, options = {}) {
  const normalizedItemId = String(itemId);
  if (retryingItems.has(normalizedItemId)) return;
  const state = readState();
  const item = state?.items?.find((candidate) => String(candidate.id) === normalizedItemId);
  if (!item) {
    const message = "상품 정보를 찾지 못했습니다. 새로고침 후 다시 시도하세요.";
    showMessage(message);
    announceReviewRegeneration(options, "error", message);
    return;
  }
  if (active?.itemId === normalizedItemId || queue.some((job) => job.itemId === normalizedItemId)) {
    announceReviewRegeneration(options, "error", "같은 상품의 상세페이지 작업이 이미 진행 중입니다.");
    return;
  }
  retryingItems.add(normalizedItemId);
  announceReviewRegeneration(options, "progress", "재생성할 작업과 저장된 체크포인트를 확인하고 있습니다.");
  const checkpointed = options.mode === "full" ? null : [...jobsById.values()]
    .filter((candidate) => isCheckpointedGenerationFailure(candidate, normalizedItemId))
    .filter((candidate) => !options.requestedJobId || candidate.jobId === options.requestedJobId)
    .sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""))[0];
  if (options.mode === "resume" && !checkpointed) {
    const message = "선택한 작업에서 안전하게 재사용할 체크포인트를 찾지 못했습니다. 전체 재생성을 별도로 선택하세요.";
    retryingItems.delete(normalizedItemId);
    showMessage(message);
    announceReviewRegeneration(options, "error", message);
    return;
  }
  if (checkpointed) {
    try {
      const resumed = await updateServerJob(checkpointed.jobId, {
        action: "resume_checkpointed_generation",
      });
      if (!resumed) throw new Error("이어 실행할 상세페이지 작업을 찾지 못했습니다.");
      patchItem(normalizedItemId, {
        detailPageAutomation: {
          ...item.detailPageAutomation,
          jobId: resumed.jobId,
          status: "queued",
          stage: "checkpoint_resume",
          message: "기존 승인 자산 유지 · 실패 지점부터 이어서 생성 중",
          progress: Number(resumed.progress || checkpointed.progress || 10),
          qaStatus: "pending",
          attempt: Number(resumed.attempt || checkpointed.attempt || 1),
          completedAt: null,
          error: "",
          executionMode: "server-v1",
        },
      });
      announceServerJob(resumed);
      renderMonitor();
      await startWorker(resumed.jobId);
      const message = "기존 상세 섹션과 승인 이미지를 유지하고 문제 자산만 이어서 생성합니다.";
      showMessage(message, 10_000);
      announceReviewRegeneration(options, "success", message, resumed);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "체크포인트 이어 생성을 시작하지 못했습니다.";
      showMessage(message);
      announceReviewRegeneration(options, "error", message);
      return;
    } finally {
      retryingItems.delete(normalizedItemId);
    }
  }
  try {
    const [latestItem] = await loadAuthoritativeSelectedItems(state, [normalizedItemId]);
    const sourceUrl = readChinaDetailPageLink(latestItem);
    if (!sourceUrl) throw new Error("상품 상세에서 상세페이지 제작용 또는 공통 1688 링크를 확인하세요.");
    const job = {
      itemId: normalizedItemId,
      jobId: crypto.randomUUID(),
      sourceUrl,
      productName: String(latestItem.productName || latestItem.modelNumber || "상품"),
      salesOptions: readSalesOptions(latestItem),
      attempt: Number(item.detailPageAutomation?.attempt || 0) + 1,
      sourceRunId: "",
    };
    await ensureDetailPageDependencies();
    const created = await createServerJob(job);
    jobsById.set(job.jobId, created);
    queue.push(job);
    patchItem(job.itemId, {
      detailPageAutomation: {
        ...item.detailPageAutomation,
        jobId: job.jobId,
        status: "queued",
        stage: "source_collection",
        message: "다시 생성 · 1688 수집 대기 중",
        progress: 0,
        qaStatus: "pending",
        sourceUrl,
        sourceRunId: "",
        attempt: job.attempt,
        queuedAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        error: "",
        executionMode: "server-v1",
      },
    });
    if (SHOW_LOCAL_MONITOR) ensureMonitor();
    renderMonitor();
    if (CAN_EXECUTE_JOBS) void processNext();
    announceReviewRegeneration(options, "success", "전체 재생성 작업을 등록했습니다. 1688 원본 수집부터 다시 진행합니다.", created);
  } catch (error) {
    const message = error instanceof Error ? error.message : "다시 생성 작업을 등록하지 못했습니다.";
    showMessage(message);
    announceReviewRegeneration(options, "error", message);
  } finally {
    retryingItems.delete(normalizedItemId);
  }
}

function announceReviewRegeneration(options, tone, message, job = null) {
  if (!options?.requestId || DETAIL_PAGE_MODE !== "worker") return;
  window.parent?.postMessage({
    source: "commerce-os-detail-page-ai-review",
    type: "regeneration-status",
    requestId: options.requestId,
    tone,
    message,
    job,
  }, window.location.origin);
}

function isCheckpointedGenerationFailure(job, itemId) {
  return Boolean(
    job &&
      job.status === "failed" &&
      job.stage === "server_generation" &&
      String(job.itemId) === String(itemId) &&
      Array.isArray(job.payload?.evidence_urls) &&
      job.payload.evidence_urls.length > 0 &&
      job.result?.analysis?.product,
  );
}

async function restoreMonitor() {
  const state = readState();
  const hasHistory = state?.items?.some((item) => item.detailPageAutomation?.jobId);
  if (hasHistory && SHOW_LOCAL_MONITOR) ensureMonitor();
  const synced = await syncJobs();
  queueCollectingJobsFromState({ markLegacyFailed: synced });
  renderMonitor();
  void processNext();
  window.setInterval(() => void syncJobs(), POLL_INTERVAL_MS);
}

async function startClientSync() {
  await syncJobs();
  window.setInterval(() => void syncJobs(), POLL_INTERVAL_MS);
}

async function syncJobs() {
  if (syncing) return false;
  syncing = true;
  try {
    const response = await fetch(JOBS_API, {
      cache: "no-store",
      credentials: "same-origin",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true || !Array.isArray(payload.jobs)) return false;
    for (const job of payload.jobs) {
      jobsById.set(job.jobId, job);
      const ownsJob = workerOwnsJob(job);
      if (ownsJob) {
        mirrorServerJob(job);
        if (job.status === "success") applyDockedJob(job);
      }
      if (
        CAN_EXECUTE_JOBS &&
        ownsJob &&
        job.status === "queued" &&
        Date.now() - (workerResumeAt.get(job.jobId) || 0) > 30_000
      ) {
        workerResumeAt.set(job.jobId, Date.now());
        void startWorker(job.jobId).catch(() => undefined);
      }
      if (
        CAN_EXECUTE_JOBS &&
        ownsJob &&
        ["queued", "running"].includes(job.status) &&
        Date.now() - Date.parse(job.updatedAt || 0) > STALE_WORKER_MS &&
        Date.now() - (workerResumeAt.get(job.jobId) || 0) > STALE_WORKER_MS
      ) {
        workerResumeAt.set(job.jobId, Date.now());
        void startWorker(job.jobId);
      }
    }
    if (CAN_EXECUTE_JOBS) queueCollectingJobsFromState();
    renderMonitor();
    if (CAN_EXECUTE_JOBS) void processNext();
    return true;
  } catch {
    return false;
  } finally {
    syncing = false;
  }
}

function queueCollectingJobsFromState({ markLegacyFailed = false } = {}) {
  const latest = readState();
  for (const item of latest?.items || []) {
    const automation = item.detailPageAutomation;
    if (!automation?.jobId || !["queued", "running", "uploading"].includes(automation.status)) continue;
    const job = jobsById.get(automation.jobId);
    if (!job) {
      if (markLegacyFailed && !COMPILER_WORKER_EXPLICIT) {
        updateAutomation(item.id, {
          status: "failed",
          stage: "legacy_browser_job",
          message: "기존 브라우저 실행 작업은 종료되었습니다. 다시 생성하면 서버 작업으로 실행됩니다.",
          qaStatus: "failed",
          completedAt: new Date().toISOString(),
          error: "새 백그라운드 작업 원장이 없는 구형 실행입니다.",
        });
      }
      continue;
    }
    if (!workerOwnsJob(job)) continue;
    if (
      job.status === "collecting" &&
      active?.jobId !== job.jobId &&
      !queue.some((queued) => queued.jobId === job.jobId)
    ) {
      queue.push({
        itemId: job.itemId,
        jobId: job.jobId,
        sourceUrl: job.sourceUrl,
        productName: String(item.productName || item.modelNumber || "상품"),
        salesOptions: readSalesOptions(item),
        attempt: Number(job.attempt || automation.attempt || 1),
        sourceRunId: job.sourceRunId || automation.sourceRunId || "",
      });
    }
  }
}

function mirrorServerJob(job) {
  const state = readState();
  const item = state?.items?.find((candidate) => String(candidate.id) === String(job.itemId));
  if (!item || item.detailPageAutomation?.jobId !== job.jobId) return;
  const mappedStatus =
    job.status === "success"
      ? "completed"
      : ["failed", "cancelled"].includes(job.status)
        ? "failed"
        : job.status === "render_pending"
          ? "uploading"
          : "running";
  const current = item.detailPageAutomation || {};
  const next = {
    status: mappedStatus,
    stage: job.stage,
    message: job.message,
    progress: Number(job.progress || 0),
    qaStatus: job.qaStatus,
    sourceRunId: job.sourceRunId || current.sourceRunId || "",
    error: job.error || "",
    startedAt: job.startedAt || current.startedAt,
    completedAt: job.completedAt || current.completedAt,
    executionMode: "server-v1",
  };
  if (
    current.status === next.status &&
    current.stage === next.stage &&
    current.message === next.message &&
    Number(current.progress || 0) === next.progress &&
    current.qaStatus === next.qaStatus &&
    current.error === next.error &&
    current.sourceRunId === next.sourceRunId
  ) return;
  updateAutomation(job.itemId, next);
}

function applyDockedJob(job, fallbackName = "") {
  const result = job.result || {};
  const detailImageUrl = String(result.detailImageUrl || "");
  const mainImageUrl = String(result.mainImageUrl || "");
  const additionalImageUrls = Array.isArray(result.additionalImageUrls)
    ? result.additionalImageUrls.filter(Boolean).slice(0, 4)
    : [];
  if (!detailImageUrl || !mainImageUrl || additionalImageUrls.length !== 4) return;
  const state = readState();
  const item = state?.items?.find((candidate) => String(candidate.id) === String(job.itemId));
  if (!item || item.detailPageAutomation?.jobId !== job.jobId) return;
  const now = job.completedAt || new Date().toISOString();
  const productName = fallbackName || item.productName || item.modelNumber || "상품";
  const detailHtml = buildDetailHtml(detailImageUrl, productName);
  const currentAsset = item.detailPageAsset || {};
  if (
    currentAsset.resultId === job.jobId &&
    item.detailPageAutomation?.status === "completed" &&
    currentAsset.syncedAt === now &&
    currentAsset.detailImageUrl === detailImageUrl &&
    currentAsset.mainImageUrl === mainImageUrl &&
    currentAsset.html === detailHtml &&
    sameStringList(currentAsset.additionalImageUrls, additionalImageUrls)
  ) return;
  patchItem(job.itemId, (current) => ({
    detailPageAsset: {
      ...current.detailPageAsset,
      status: "ready",
      resultId: job.jobId,
      html: detailHtml,
      detailImageUrl,
      mainImageUrl,
      additionalImageUrls,
      syncedAt: now,
    },
    detailPageAutomation: {
      ...current.detailPageAutomation,
      status: "completed",
      stage: "docked",
      message: "검수 통과 · 상세 HTML과 이미지 URL 자동 도킹 완료",
      progress: 100,
      qaStatus: "passed",
      completedAt: now,
      error: "",
      executionMode: "server-v1",
    },
    stages: {
      ...current.stages,
      detailPage: {
        ...current.stages?.detailPage,
        status: "완료",
        completedAt: now,
        note: "상세페이지 서버 자동 생성·검수 통과 후 결과 도킹",
      },
    },
    updatedAt: now,
    updatedBy: "상세페이지 백그라운드 자동 도킹",
  }));
}

async function startWorker(jobId) {
  const response = await fetch(`${JOBS_API}/${encodeURIComponent(jobId)}/start`, {
    method: "POST",
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.message || "Studio 서버 작업을 시작하지 못했습니다.");
  }
  return payload;
}

async function updateServerJob(jobId, body) {
  const response = await fetch(`${JOBS_API}/${encodeURIComponent(jobId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.message || "상세페이지 작업 상태를 저장하지 못했습니다.");
  }
  if (payload.job) jobsById.set(jobId, payload.job);
  return payload.job;
}

function ensureMonitor() {
  if (!SHOW_LOCAL_MONITOR) return null;
  if (monitor) return monitor;
  monitor = document.createElement("aside");
  monitor.id = "detail-page-dock-monitor";
  monitor.innerHTML = `
    <div class="dock-monitor-header">
      <div><strong>상세페이지 자동 생성</strong><span id="dock-monitor-summary"></span></div>
      <button type="button" id="dock-monitor-toggle" aria-label="진행창 접기">−</button>
    </div>
    <div id="dock-monitor-body">
      <div id="dock-monitor-jobs"></div>
      <div class="dock-monitor-footer">
        <span>AI 생성은 서버에서 계속됩니다.</span>
        <button type="button" id="dock-retry-failed">실패 작업 다시 생성</button>
      </div>
    </div>`;
  document.body.append(monitor);
  monitor.querySelector("#dock-monitor-toggle")?.addEventListener("click", () => {
    monitor.classList.toggle("is-collapsed");
    const button = monitor.querySelector("#dock-monitor-toggle");
    if (button) button.textContent = monitor.classList.contains("is-collapsed") ? "+" : "−";
  });
  monitor.querySelector("#dock-retry-failed")?.addEventListener("click", () => {
    const state = readState();
    for (const item of state?.items || []) {
      if (item.detailPageAutomation?.status === "failed") void retryItem(item.id);
    }
  });
  monitor.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-retry-item]");
    if (button) void retryItem(button.dataset.retryItem);
    const detail = event.target.closest("button[data-open-item]");
    if (detail) {
      document.querySelector(`tr[data-id='${cssEscape(detail.dataset.openItem)}'] button[data-action='detail']`)?.click();
    }
  });
  return monitor;
}

function openRequestedItem(itemId, attempts = 0) {
  const detailButton = document.querySelector(
    `tr[data-id='${cssEscape(itemId)}'] button[data-action='detail']`,
  );
  if (detailButton) {
    detailButton.click();
    return;
  }
  if (attempts < 40) {
    window.setTimeout(() => openRequestedItem(itemId, attempts + 1), 250);
  }
}

function renderMonitor() {
  if (!monitor) return;
  const state = readState();
  const items = (state?.items || [])
    .filter((item) => item.detailPageAutomation?.jobId)
    .sort((left, right) => Date.parse(right.detailPageAutomation?.queuedAt || 0) - Date.parse(left.detailPageAutomation?.queuedAt || 0))
    .slice(0, 8);
  const runningCount = items.filter((item) => ["queued", "running", "uploading"].includes(item.detailPageAutomation?.status)).length;
  const failedCount = items.filter((item) => item.detailPageAutomation?.status === "failed").length;
  const summary = monitor.querySelector("#dock-monitor-summary");
  if (summary) summary.textContent = runningCount ? `진행 ${runningCount}건 · 화면 종료 가능` : failedCount ? `실패 ${failedCount}건` : "대기 작업 없음";
  const body = monitor.querySelector("#dock-monitor-jobs");
  if (!body) return;
  body.innerHTML = items.length ? items.map((item) => {
    const job = item.detailPageAutomation || {};
    const status = job.status || "queued";
    const label = {
      queued: "대기",
      running: "서버 생성 중",
      uploading: "최종 도킹 중",
      completed: "완료",
      failed: "실패",
    }[status] || status;
    return `<article class="dock-job dock-status-${escapeAttribute(status)}">
      <div class="dock-job-title"><strong>${escapeHtml(item.modelNumber || item.productName || item.id)}</strong><span>${label}</span></div>
      <p>${escapeHtml(job.message || "생성 대기 중")}</p>
      <div class="dock-progress"><i style="width:${clamp(Number(job.progress) || 0, 0, 100)}%"></i></div>
      ${job.error ? `<p class="dock-error">${escapeHtml(job.error)}</p>` : ""}
      <div class="dock-job-meta">시도 ${Number(job.attempt || 1)}회 · 검수 ${job.qaStatus === "passed" ? "통과" : job.qaStatus === "failed" ? "실패" : "진행 중"}${["running", "uploading"].includes(status) ? " · 새로고침·화면이동 가능" : ""}</div>
      <div class="dock-job-actions">
        <button type="button" data-open-item="${escapeAttribute(item.id)}">상품 상세</button>
        ${["failed", "completed"].includes(status) ? `<button type="button" data-retry-item="${escapeAttribute(item.id)}">다시 생성</button>` : ""}
      </div>
    </article>`;
  }).join("") : '<p class="dock-empty">생성 작업이 없습니다.</p>';
  const retry = monitor.querySelector("#dock-retry-failed");
  if (retry) retry.disabled = failedCount === 0;
}

async function getEngineConfig() {
  if (engineConfig) return engineConfig;
  const response = await fetch(ENGINE_CONFIG_API, { cache: "no-store", credentials: "same-origin" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true || !payload.engineUrl || !payload.engineOrigin) {
    throw new Error(payload.message || "상세페이지 엔진 연결 설정을 읽지 못했습니다.");
  }
  engineConfig = payload;
  return payload;
}

async function ensureDetailPageDependencies() {
  await Promise.all([getEngineConfig(), ensureLocalCollectorReady()]);
}

async function probeLocalCollectorReady(timeoutMs = LOCAL_BRIDGE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(LOCAL_BRIDGE_HEALTH_URL, {
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
      targetAddressSpace: "loopback",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`status=${response.status}`);
    if (
      payload.ok !== true ||
      payload.service !== "product-detail-page-auto-local-ops-bridge"
    ) {
      throw new Error("unexpected-local-bridge");
    }
    if (payload.evidence_import_supported !== true) {
      throw new Error(
        "로컬 수집기 업데이트가 필요합니다. 최신 수집기를 실행한 뒤 다시 시도하세요.",
      );
    }
    return payload;
  } finally {
    window.clearTimeout(timer);
  }
}

function requestLocalCollectorStart() {
  window.location.href = LOCAL_BRIDGE_START_PROTOCOL;
}

async function waitForLocalCollectorReady() {
  const deadline = Date.now() + LOCAL_BRIDGE_START_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, LOCAL_BRIDGE_RETRY_INTERVAL_MS));
    try {
      await probeLocalCollectorReady(2_000);
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes("업데이트")) throw error;
    }
  }
  return false;
}

async function ensureLocalCollectorReady() {
  try {
    await probeLocalCollectorReady();
    return;
  } catch (error) {
    if (error instanceof Error && error.message.includes("업데이트")) throw error;
  }

  const shouldStart = window.confirm(
    "승준컴 로컬 수집기가 꺼져 있거나 Chrome 연결 권한이 아직 허용되지 않았습니다.\n\n확인을 누르면 수집기를 자동 실행하고 약 12초 동안 다시 연결합니다.",
  );
  if (shouldStart) {
    showRunStatus("승준컴 로컬 수집기 자동 실행 요청 · 연결을 다시 확인하고 있습니다.", "progress");
    requestLocalCollectorStart();
    if (await waitForLocalCollectorReady()) return;
  }

  throw new Error(
    shouldStart
      ? "수집기 자동 실행 후에도 연결되지 않았습니다. Chrome 주소창 왼쪽 사이트 설정에서 ‘로컬 네트워크 액세스’를 허용한 뒤 다시 누르세요. 권한이 이미 허용되어 있다면 승준컴 브릿지 프로토콜 설치 또는 PowerShell 수집기 실행 상태를 확인하세요."
      : "상세페이지 생성에는 승준컴 로컬 수집기가 필요합니다. 다시 실행할 때 자동 실행 확인창에서 ‘확인’을 누르거나 수집기 PowerShell 창을 켜주세요.",
  );
}

function markFrameConnected() {
  window.clearTimeout(activeHandshakeTimer);
  activeHandshakeTimer = null;
  if (activeTimer) return;
  activeTimer = window.setTimeout(() => {
    void handleFrameTimeout();
  }, FRAME_TIMEOUT_MS);
}

function selectedRowIds() {
  return [...document.querySelectorAll("#launch-table-body tr[data-id] input.row-check:checked")]
    .map((input) => String(input.closest("tr[data-id]")?.dataset.id || ""))
    .filter(Boolean);
}

function readSalesOptions(item) {
  return (Array.isArray(item?.orderOptions) ? item.orderOptions : [])
    .map((option) => String(option?.saleOption || "").trim())
    .filter(Boolean)
    .join(" / ")
    .slice(0, 2000);
}

async function loadAuthoritativeSelectedItems(state, selectedIds) {
  const localItems = Array.isArray(state?.items) ? state.items : [];
  const orderSelected = (items) => {
    const byId = new Map(items.map((item) => [String(item?.id ?? ""), item]));
    const selected = selectedIds.map((itemId) => byId.get(itemId)).filter(Boolean);
    if (selected.length !== selectedIds.length) {
      throw new Error(
        "선택 상태와 상품 데이터가 일치하지 않습니다. 목록을 새로고침한 뒤 다시 선택하세요.",
      );
    }
    return selected;
  };

  if (state?.partialPage !== true) return orderSelected(localItems);

  const params = new URLSearchParams({ mode: "items" });
  selectedIds.forEach((itemId) => params.append("id", itemId));
  const response = await fetch(
    OPTIMIZED_TRACKER_API + "?" + params.toString(),
    { credentials: "same-origin", cache: "no-store" },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true || !Array.isArray(payload.items)) {
    throw new Error(
      payload?.message ||
        "선택 상품의 최신 상세정보를 서버에서 불러오지 못했습니다.",
    );
  }
  return orderSelected(payload.items);
}

function readState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function patchItem(itemId, patch) {
  const state = readState();
  if (!state?.items) return;
  const now = new Date().toISOString();
  state.items = state.items.map((item) => {
    if (String(item.id) !== String(itemId)) return item;
    const changes = typeof patch === "function" ? patch(item) : patch;
    return { ...item, ...changes, updatedAt: changes.updatedAt || now };
  });
  state.savedAt = now;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("product-launch-tracker:external-state"));
}

function updateAutomation(itemId, patch) {
  patchItem(itemId, (item) => ({
    detailPageAutomation: { ...item.detailPageAutomation, ...patch },
  }));
}

function sameStringList(left, right) {
  const normalizedLeft = Array.isArray(left) ? left.map(String) : [];
  const normalizedRight = Array.isArray(right) ? right.map(String) : [];
  return normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function base64File(base64, mimeType, name) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], name, { type: mimeType });
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
}

function cleanMultiline(value, maxLength) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxLength);
}

function isValidJobId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || ""),
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function cssEscape(value) {
  return window.CSS?.escape ? window.CSS.escape(String(value || "")) : String(value || "").replace(/['\\]/g, "\\$&");
}

function showMessage(message, duration = 4200) {
  const toast = document.querySelector("#toast");
  if (toast) {
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(messageTimer);
    messageTimer = window.setTimeout(() => {
      toast.hidden = true;
      messageTimer = null;
    }, duration);
  } else window.alert(message);
}

function showRunStatus(message, tone = "neutral", duration = 0) {
  if (!runStatus) return;
  window.clearTimeout(runStatusTimer);
  runStatusTimer = null;
  runStatus.textContent = String(message || "");
  runStatus.dataset.tone = tone;
  runStatus.hidden = !runStatus.textContent;
  if (duration > 0) {
    runStatusTimer = window.setTimeout(() => {
      runStatus.hidden = true;
      runStatusTimer = null;
    }, duration);
  }
}

function installStyles() {
  const style = document.createElement("style");
  style.id = "detail-page-dock-styles";
  style.textContent = `
    #detail-page-dock-engine-frame{position:fixed!important;left:-20px!important;bottom:-20px!important;width:1px!important;height:1px!important;opacity:.01!important;border:0!important;pointer-events:none!important}
    #detail-page-dock-run-status{flex:1 0 100%;margin:2px 0 0;padding:7px 9px;border-radius:7px;background:#f8fafc;color:#475569;font-size:11px;font-weight:800;line-height:1.4}
    #detail-page-dock-run-status[data-tone="progress"]{background:#eff6ff;color:#1d4ed8}
    #detail-page-dock-run-status[data-tone="success"]{background:#ecfdf5;color:#047857}
    #detail-page-dock-run-status[data-tone="error"]{background:#fff1f2;color:#be123c}
    #detail-page-dock-monitor{position:fixed;right:18px;bottom:18px;z-index:70;width:min(390px,calc(100vw - 36px));max-height:min(620px,calc(100vh - 36px));overflow:hidden;border:1px solid #cbd5e1;border-radius:16px;background:#fff;box-shadow:0 18px 48px rgba(15,23,42,.24);font-size:13px;color:#0f172a}
    .dock-monitor-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 14px;background:#0f172a;color:#fff}.dock-monitor-header div{display:flex;flex-direction:column;gap:2px}.dock-monitor-header span{font-size:11px;color:#cbd5e1}.dock-monitor-header button{width:28px;height:28px;border:0;border-radius:8px;background:#334155;color:#fff;font-weight:900;cursor:pointer}
    #dock-monitor-body{max-height:540px;overflow:auto;padding:10px;background:#f8fafc}.is-collapsed #dock-monitor-body{display:none}.dock-job{margin-bottom:9px;padding:11px;border:1px solid #e2e8f0;border-left:4px solid #2563eb;border-radius:10px;background:#fff}.dock-status-completed{border-left-color:#059669}.dock-status-failed{border-left-color:#dc2626}.dock-job-title{display:flex;justify-content:space-between;gap:10px}.dock-job-title span{font-size:11px;font-weight:800}.dock-job p{margin:6px 0 0;line-height:1.45;color:#475569}.dock-progress{height:6px;margin-top:8px;overflow:hidden;border-radius:999px;background:#e2e8f0}.dock-progress i{display:block;height:100%;border-radius:inherit;background:#2563eb;transition:width .25s}.dock-status-completed .dock-progress i{background:#059669}.dock-status-failed .dock-progress i{background:#dc2626}.dock-error{color:#b91c1c!important}.dock-job-meta{margin-top:7px;font-size:11px;color:#64748b}.dock-job-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:8px}.dock-job-actions button,.dock-monitor-footer button{min-height:30px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;padding:0 9px;font:inherit;font-weight:800;cursor:pointer}.dock-monitor-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:2px}.dock-monitor-footer span{font-size:11px;color:#2563eb}.dock-monitor-footer button:disabled{opacity:.45;cursor:not-allowed}.dock-empty{padding:18px;text-align:center;color:#64748b}
  `;
  document.head.append(style);
}
