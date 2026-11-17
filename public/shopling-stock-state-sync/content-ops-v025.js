(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const STATE_KEY = "commerceOsShoplingStockStateSyncV013";
  const READY = "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY_HF27";
  const PING = "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF27";
  const START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF27";
  const RESULT = "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT_HF27";
  const PROGRESS = "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS_HF27";
  const STATUS = "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF27";
  const API_PATH = "/api/inventory-stock-control/shopling-option-status";
  const post = (payload) =>
    window.postMessage(
      { ...payload, extensionVersion: VERSION, stockSyncChannel: "HF27" },
      location.origin,
    );
  const norm = (value) => String(value ?? "").normalize("NFKC").trim();

  function normalizedCoalescedJobs(rawJob) {
    const requested = Array.isArray(rawJob?.coalescedJobs)
      ? rawJob.coalescedJobs
      : [rawJob];
    const unique = [];
    const seen = new Set();
    for (const candidate of requested) {
      const jobId = norm(candidate?.jobId);
      if (!jobId || seen.has(jobId)) continue;
      seen.add(jobId);
      const job = { ...(candidate || {}) };
      delete job.coalescedJobs;
      unique.push(job);
    }
    if (!unique.length) return [];
    if (unique.length === 1) return unique;
    const first = unique[0];
    const modelNo = norm(first?.modelNo).toUpperCase();
    const desiredStatus = norm(first?.desiredStatus).toUpperCase();
    const safe =
      unique.length <= 50 &&
      norm(first?.jobId) === norm(rawJob?.jobId) &&
      norm(first?.productKind).toUpperCase() === "OPTION" &&
      Boolean(modelNo) &&
      unique.every(
        (job) =>
          norm(job?.productKind).toUpperCase() === "OPTION" &&
          norm(job?.modelNo).toUpperCase() === modelNo &&
          norm(job?.desiredStatus).toUpperCase() === desiredStatus,
      );
    return safe ? unique : [{ ...rawJob, coalescedJobs: undefined }];
  }

  function postResultForJobs(payload) {
    const jobs = Array.isArray(payload?.job?.stockStateCoalescedJobsHf87)
      ? payload.job.stockStateCoalescedJobsHf87
      : [];
    if (!jobs.length) {
      post({ type: RESULT, ...payload });
      return;
    }
    for (const job of jobs) {
      post({
        type: RESULT,
        ...payload,
        jobId: job.jobId,
        job,
        message:
          jobs.length > 1
            ? `${job.barcode} · 동일 모델 ${jobs.length}개 B코드 API 선적용 후 A21 1회 전송 · ${payload.message || "처리 완료"}`
            : payload.message,
        evidence: {
          ...(payload.evidence || {}),
          coalescedTransmission: jobs.length > 1,
          coalescedJobIds: jobs.map((row) => row.jobId),
          sharedA21OwnerJobId: payload.jobId,
        },
      });
    }
  }

  async function announce() {
    post({ type: READY });
    const response = await chrome.runtime
      .sendMessage({ type: "STOCK_SYNC_GET_STATUS" })
      .catch(() => null);
    if (!response?.ok) return;
    let active = response.active ?? null;
    const lastResult = response.lastResult ?? null;
    const staleTerminalRunning =
      active?.status === "RUNNING" &&
      active?.job?.jobId === lastResult?.jobId &&
      ["SUCCEEDED", "FAILED", "UNCERTAIN"].includes(lastResult?.outcome) &&
      Number(lastResult?.finishedAt || 0) >= Number(active?.startedAt || 0);
    if (staleTerminalRunning) {
      await chrome.storage.local.remove(STATE_KEY);
      active = null;
    }
    post({ type: STATUS, active });
    if (lastResult && Date.now() - Number(lastResult.finishedAt || 0) < 3_600_000) {
      postResultForJobs(lastResult);
    }
  }

  async function applyStockStateApi(job) {
    post({
      type: PROGRESS,
      jobId: job?.jobId || "",
      stage: "SHOPLING_API_STOCK_STATE",
      message: `${job?.barcode || "B코드"} · 서버 인덱스 후보를 Shopling API로 재검증하고 상태·수량을 확인합니다.`,
      job,
    });
    const response = await fetch(`${location.origin}${API_PATH}`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        jobId: job?.jobId || "",
        barcode: job?.barcode || "",
        productKind: job?.productKind || "",
        desiredStatus: job?.desiredStatus || "",
        goodsKeys: Array.isArray(job?.goodsKeys) ? job.goodsKeys : [],
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok || !Array.isArray(payload?.result?.goodsKeys)) {
      throw new Error(payload?.message || `Shopling 상태 API 처리 실패 (HTTP ${response.status})`);
    }
    if (!payload.result.goodsKeys.length || !Array.isArray(payload.result.receipts)) {
      throw new Error("Shopling API 검증 goods key 또는 실행 영수증이 없습니다.");
    }
    return payload.result;
  }

  function buildCoalescedJob(jobs, apiResults) {
    const transmissions = new Map();
    const goodsKeys = new Set();
    const receipts = [];
    const resultJobs = jobs.map((job, index) => {
      const result = apiResults[index];
      for (const goodsKey of result.goodsKeys || []) goodsKeys.add(String(goodsKey));
      for (const row of result.transmissions || []) {
        transmissions.set(String(row?.goodsKey || ""), row);
      }
      receipts.push(...(result.receipts || []));
      return {
        ...job,
        goodsKeys: [...new Set((result.goodsKeys || []).map(String))],
        stockStateApiEvidence: result.receipts || [],
      };
    });
    const orderedGoodsKeys = [...goodsKeys].filter(Boolean);
    const transmissionRows = orderedGoodsKeys.map((goodsKey) => transmissions.get(goodsKey));
    if (
      !orderedGoodsKeys.length ||
      transmissionRows.some((row) => !row)
    ) {
      throw new Error("동일 모델 API 선적용 후 goods key별 전송 분기표가 완전하지 않습니다.");
    }
    const firstTransmission = transmissionRows[0];
    return {
      ...jobs[0],
      logicalProductKind: String(jobs[0]?.productKind || "").toUpperCase(),
      productKind: firstTransmission?.effectiveProductKind || jobs[0]?.productKind,
      goodsKeys: orderedGoodsKeys,
      stockStateTransmissions: transmissionRows,
      stockStateApiApplied: true,
      optionApiApplied: false,
      productStatusApiApplied: transmissionRows.some(
        (row) => row?.transmissionKind === "PRODUCT_SALE_STATUS_SEND",
      ),
      goodsKeySource: "SHOPLING_BCODE_API_INDEX_AND_LIVE_OPTION_SHAPE",
      stockStateApiEvidence: receipts,
      stockStateCoalescedJobsHf87: resultJobs,
      stockStateCoalescedApiCountHf87: jobs.length,
    };
  }

  async function failJobs(jobs, message, evidence) {
    for (const job of jobs) {
      post({
        type: RESULT,
        jobId: job?.jobId || "",
        job: job || null,
        outcome: "FAILED",
        message,
        evidence,
        finishedAt: Date.now(),
      });
    }
  }

  async function startFromOps(rawJob) {
    const jobs = normalizedCoalescedJobs(rawJob);
    if (!jobs.length) return;
    const apiResults = [];
    try {
      for (const job of jobs) apiResults.push(await applyStockStateApi(job));
    } catch (error) {
      await failJobs(
        jobs,
        String(error?.message || error || "Shopling API 상태 검증 실패"),
        {
          code: "SHOPLING_STOCK_STATE_COALESCED_API_FAILED",
          browserMutationStarted: false,
          appliedApiCount: apiResults.length,
          coalescedJobIds: jobs.map((job) => job.jobId),
        },
      );
      return;
    }

    let job;
    try {
      job = buildCoalescedJob(jobs, apiResults);
    } catch (error) {
      await failJobs(jobs, String(error?.message || error), {
        code: "SHOPLING_STOCK_STATE_COALESCED_PLAN_FAILED",
        browserMutationStarted: false,
      });
      return;
    }
    const response = await chrome.runtime.sendMessage({ type: "STOCK_SYNC_START", job });
    if (response?.ok) {
      post({
        type: PROGRESS,
        jobId: job.jobId,
        stage: response.active?.stage || "A21_LIST",
        message:
          jobs.length > 1
            ? `동일 모델 B코드 ${jobs.length}건 API 선적용 완료 · 중복 없이 A21 1회 전송을 시작했습니다.`
            : response.message || "Shopling API 검증 완료 · A21 전송을 시작했습니다.",
        job: response.active?.job || job,
        apiVerifiedGoodsKeys: job.goodsKeys,
        apiReceipts: job.stockStateApiEvidence,
      });
      return;
    }
    await failJobs(
      job.stockStateCoalescedJobsHf87,
      response?.message || "A21 전송을 시작하지 못했습니다.",
      {
        code: response?.code || "STOCK_SYNC_START_FAILED",
        missing: response?.missing || [],
        apiReceipts: job.stockStateApiEvidence,
      },
    );
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === PING) {
      void announce();
      return;
    }
    if (data.type !== START) return;
    void startFromOps(data.job).catch((error) => {
      const jobs = normalizedCoalescedJobs(data.job);
      void failJobs(
        jobs,
        String(error?.message || error || "Shopling 확장프로그램 통신 실패"),
        { code: "SHOPLING_API_FIRST_RUNTIME_FAILED" },
      );
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "STOCK_SYNC_PROGRESS") post({ type: PROGRESS, ...message.payload });
    if (message?.type === "STOCK_SYNC_RESULT") postResultForJobs(message.payload);
  });

  if (globalThis.__COMMERCE_OS_EXPOSE_STOCK_HF87_OPS_TEST_HOOKS__ === true) {
    globalThis.__commerceOsStockHf87OpsTestHooks = {
      normalizedCoalescedJobs,
      buildCoalescedJob,
      postResultForJobs,
    };
    return;
  }
  void announce();
  window.addEventListener("DOMContentLoaded", () => void announce(), { once: true });
})();
