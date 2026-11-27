/* Versioned packaging changes. Refuse to publish the ZIP if its known base
 * changes underneath the ordered-plan and original-receipt integration. */
function replaceOnce(source: string, marker: string, replacement: string) {
  const start = source.indexOf(marker);
  if (start < 0 || source.indexOf(marker, start + marker.length) >= 0) {
    throw new Error(`shopling_hf102_base_checkpoint_missing:${marker.slice(0, 60)}`);
  }
  return source.slice(0, start) + replacement + source.slice(start + marker.length);
}

function replaceBetween(source: string, from: string, to: string, replacement: string) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  if (start < 0 || end < 0) throw new Error("shopling_hf102_base_section_missing");
  return replaceOnce(source, source.slice(start, end), replacement);
}

export function patchMarketPlanOps(source: string) {
  let ops = source.replace(/\r\n?/g, "\n");
  ops = replaceOnce(ops, "        jobId: job?.jobId || \"\",\n        barcode:", "        planVersion: 2,\n        stockBatchPlan: job.stockBatchPlan,\n        jobId: job?.jobId || \"\",\n        barcode:");
  ops = replaceOnce(ops, "    if (!Array.isArray(payload.result.receipts))", "    if (payload.result.planVersion !== 2) throw new Error(\"Shopling 상품·옵션 전송 계획 버전을 확인하지 못했습니다.\");\n    if (!Array.isArray(payload.result.receipts))");
  ops = replaceOnce(ops, "  async function startFromOps(rawJob) {", `  async function startFromOps(rawJob) {
    const jobs = normalizedCoalescedJobs(rawJob);
    if (!jobs.length) return;
    if (!navigator.locks) {
      return failJobs(jobs, "다른 OPS 탭의 작업 상태를 확인하지 못했습니다.", { code: "SHOPLING_HF102_LOCK_UNAVAILABLE", browserMutationStarted: false });
    }
    await navigator.locks.request("commerce-os-shopling-market-plan-v2", { ifAvailable: true }, async (lock) => {
      const idle = lock && await chrome.runtime.sendMessage({ type: "STOCK_SYNC_GET_IDLE_STATUS_HF94" }).catch(() => null);
      if (idle?.ok !== true || idle.idleConfirmed !== true) {
        return failJobs(jobs, "다른 Shopling 작업이 진행 중이거나 실행기 준비 상태를 확인하지 못했습니다.", {
          code: "SHOPLING_HF102_BUSY_BEFORE_API", browserMutationStarted: false, retrySafe: true,
        });
      }
      return startLockedMarketPlan(rawJob);
    });
  }

  async function startLockedMarketPlan(rawJob) {`);
  ops = replaceOnce(ops, "    const response = await fetch(`${location.origin}${API_PATH}`, {", `    if (!job.stockBatchPlan) {
      if (job.batchId || job.parallelBatchId || job.operationalBatchId) {
        throw new Error("일괄 전송의 사전 계획을 찾지 못했습니다.");
      }
      const preflight = await fetch(location.origin + API_PATH, {
        method: "POST", credentials: "include", cache: "no-store",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ mode: "PREFLIGHT_BATCH", items: [{
          barcode: job.barcode, desiredStatus: job.desiredStatus, productKind: job.productKind, goodsKeys: job.goodsKeys || [],
        }] }),
      });
      const payload = await preflight.json().catch(() => ({}));
      const items = payload?.result?.items;
      const item = Array.isArray(items) && items.length === 1 ? items[0] : null;
      if (!preflight.ok || !payload?.ok || payload.result.planVersion !== 2 || item?.barcode !== job.barcode ||
          item?.desiredStatus !== job.desiredStatus || item?.productKind !== job.productKind ||
          !Array.isArray(item.dependencies) || item.dependencies.length || typeof item.stockBatchPlan !== "string" || !item.stockBatchPlan) {
        throw new Error(payload?.message || "단일 B코드 전송 사전 확인에 실패했습니다.");
      }
      job.stockBatchPlan = item.stockBatchPlan;
    }
    const response = await fetch(location.origin + API_PATH, {`);
  ops = replaceOnce(ops, "    const apiResults = [];\n    try {", `    const apiResults = [];
    try {
      if ((rawJob?.coalescedJobs?.length || 0) > 1 || jobs.length !== 1) {
        throw new Error("상품 상태 전송은 B코드별로 한 건씩 진행해야 합니다.");
      }`);
  ops = replaceBetween(ops, "    const transmissions = new Map();", "    const firstTransmission =", `    const result = apiResults[0];
    const orderedGoodsKeys = result.goodsKeys;
    const receipts = result.receipts;
    const transmissionRows = result.transmissions;
    const resultJobs = [{ ...jobs[0], goodsKeys: orderedGoodsKeys, stockStateApiEvidence: receipts }];
    if (jobs.length !== 1 || !Array.isArray(transmissionRows) || !transmissionRows.length) {
      throw new Error("검증된 상품·옵션 전송 단계가 없습니다.");
    }
`);
  ops = replaceOnce(ops, "      stockStateTransmissions: transmissionRows,", "      stockStateTransmissions: transmissionRows,\n      stockPlanVersion: 2,\n      stockPlanOwnerId: jobs[0].jobId,");
  ops = replaceOnce(ops, '            code: "HF99_ENDED_ONLY_NO_TRANSMISSION",', '            code: "HF99_ENDED_ONLY_NO_TRANSMISSION",\n            stockPlanComplete: true,');
  return replaceOnce(ops, 'if (message?.type === "STOCK_SYNC_PROGRESS") post({ type: PROGRESS, ...message.payload });',
    `if (message?.type === "STOCK_SYNC_PROGRESS") {
      const payload = message.payload;
      const parent = payload?.job?.stockStateCoalescedJobsHf87?.[0];
      post(parent && payload.job.stockPlanVersion === 2
        ? { ...payload, type: PROGRESS, jobId: parent.jobId, job: parent }
        : { ...payload, type: PROGRESS });
    }`);
}

export function patchMarketPlanGrouping(source: string, helpers: string) {
  let worker = source.replace(/\r\n?/g, "\n");
  worker = replaceOnce(worker, 'importScripts("background-v091.js");', 'importScripts("background-v091.js");\n' + helpers);
  // HF80 checks distinct API-readback keys, then assumes contiguous sequence
  // IDs per goods key. V2 explicitly carries each direction and lane instead.
  worker = replaceBetween(worker, "    const normalizedRows = [];", "    const receiptKeys =", `    let groups;
    if (job.stockPlanVersion !== 2 || job.stockPlanOwnerId !== jobId) {
      return { ok: false, code: "SHOPLING_HF102_VERSIONED_PLAN_REQUIRED" };
    }
    try { groups = globalThis.shoplingMarketPlanHf102.groups({ ...job, logicalProductKind }); }
    catch (error) { return { ok: false, code: error.message, message: "전송 계획의 상품·옵션 단계가 일치하지 않습니다." }; }
    const normalizedRows = rows;
`);
  worker = replaceBetween(worker, "    const groups = [];", "    if (!groups.length)", "");
  worker = replaceOnce(worker, "    active.job.productKind = group.effectiveProductKind;", "    globalThis.shoplingMarketPlanHf102.prepare(active, group);\n    active.job.productKind = group.effectiveProductKind;");
  worker = replaceOnce(worker, "  function resetForNextBatchV092(active) {", "  function resetForNextBatchV092(active) {\n    globalThis.shoplingMarketPlanHf102.clearPreviousPopup(active);");
  return replaceOnce(worker, "      active.goodsKeyIndex = nextStart;\n      resetForNextBatchV092(active);", "      active.goodsKeyIndex = nextStart;\n      resetForNextBatchV092(active);\n      prepareCurrentGroupV092(active);");
}

export function patchMarketResultWatcher(source: string) {
  return replaceOnce(source.replace(/\r\n?/g, "\n"), "        if (advanced?.ok === true) {",
    `        const mayClose = latest.job?.stockPlanVersion !== 2 ||
          advanced?.continuing === true || advanced?.result?.stockPlanLegAccepted === true ||
          advanced?.result?.evidence?.stockPlanComplete === true;
        if (advanced?.ok === true && mayClose) {`);
}
