(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const STATE_KEY = "commerceOsShoplingStockStateSyncV013";
  const READY = "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY";
  const PING = "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING";
  const START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_START";
  const RESULT = "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT";
  const PROGRESS = "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS";
  const STATUS = "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS";
  const OPTION_API_PATH = "/api/inventory-stock-control/shopling-option-status";
  const post = (payload) => window.postMessage({ ...payload, extensionVersion: VERSION }, location.origin);

  async function announce() {
    post({ type: READY });
    const response = await chrome.runtime.sendMessage({ type: "STOCK_SYNC_GET_STATUS" }).catch(() => null);
    if (!response?.ok) return;
    let active = response.active ?? null;
    const lastResult = response.lastResult ?? null;
    const activeStartedAt = Number(active?.startedAt || 0);
    const lastFinishedAt = Number(lastResult?.finishedAt || 0);
    const staleTerminalRunning = active?.status === "RUNNING" && active?.job?.jobId === lastResult?.jobId && ["SUCCEEDED", "FAILED", "UNCERTAIN"].includes(lastResult?.outcome) && activeStartedAt > 0 && lastFinishedAt >= activeStartedAt;
    if (staleTerminalRunning) {
      await chrome.storage.local.remove(STATE_KEY);
      active = null;
    }
    post({ type: STATUS, active });
    if (lastResult && Date.now() - Number(lastResult.finishedAt || 0) < 3_600_000) {
      post({ type: RESULT, ...lastResult });
    }
  }

  async function applyOptionStatusApi(job) {
    post({
      type: PROGRESS,
      jobId: job?.jobId || "",
      stage: "SHOPLING_OPTION_API",
      message: `${job?.barcode || "B코드"} · Shopling API에서 옵션상태와 현재수량을 검증합니다.`,
      job,
    });
    const response = await fetch(`${location.origin}${OPTION_API_PATH}`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        jobId: job?.jobId || "",
        barcode: job?.barcode || "",
        desiredStatus: job?.desiredStatus || "",
        goodsKeys: Array.isArray(job?.goodsKeys) ? job.goodsKeys : [],
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok || !payload?.result?.matchedGoodsKey) {
      throw new Error(payload?.message || `Shopling 옵션상태 API 처리 실패 (HTTP ${response.status})`);
    }
    return payload.result;
  }

  async function startFromOps(rawJob) {
    let job = rawJob;
    if (String(job?.productKind || "").toUpperCase() === "OPTION") {
      const apiResult = await applyOptionStatusApi(job);
      job = {
        ...job,
        goodsKeys: [String(apiResult.matchedGoodsKey)],
        optionApiApplied: true,
        optionApiEvidence: {
          matchedGoodsKey: String(apiResult.matchedGoodsKey),
          targetStatusCode: String(apiResult.targetStatusCode || ""),
          statusBefore: String(apiResult.statusBefore || ""),
          statusAfter: String(apiResult.statusAfter || ""),
          optionQuantity: String(apiResult.optionQuantity || ""),
          optionId: String(apiResult.optionId || ""),
          mutated: Boolean(apiResult.mutated),
          modifyCode: String(apiResult.modifyCode || ""),
          verifiedAt: String(apiResult.verifiedAt || ""),
        },
      };
      post({
        type: PROGRESS,
        jobId: job.jobId || "",
        stage: "SHOPLING_OPTION_API_VERIFIED",
        message: `${job.barcode || "B코드"} · API 옵션상태 검증 완료 · goods key ${apiResult.matchedGoodsKey} → A21 옵션송신을 준비합니다.`,
        job,
      });
    }

    const response = await chrome.runtime.sendMessage({ type: "STOCK_SYNC_START", job });
    if (response?.ok) {
      post({
        type: PROGRESS,
        jobId: response.active?.job?.jobId || job?.jobId || "",
        stage: response.active?.stage || "STARTING",
        message: response.message || "Shopling 동기화 작업을 시작했습니다.",
        job: response.active?.job || job || null,
      });
      return;
    }
    post({
      type: RESULT,
      jobId: job?.jobId || "",
      job: job || null,
      outcome: "FAILED",
      message: response?.message || "Shopling 동기화 작업을 시작하지 못했습니다.",
      evidence: {
        code: response?.code || "STOCK_SYNC_START_FAILED",
        missing: response?.missing || [],
        optionApiEvidence: job?.optionApiEvidence || null,
      },
      finishedAt: Date.now(),
    });
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
      post({
        type: RESULT,
        jobId: data.job?.jobId || "",
        job: data.job || null,
        outcome: "FAILED",
        message: String(error?.message || error || "Shopling API/확장프로그램 통신 실패"),
        evidence: { code: "SHOPLING_OPTION_API_OR_RUNTIME_FAILED" },
        finishedAt: Date.now(),
      });
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "STOCK_SYNC_PROGRESS") post({ type: PROGRESS, ...message.payload });
    if (message?.type === "STOCK_SYNC_RESULT") post({ type: RESULT, ...message.payload });
  });
  void announce();
  window.addEventListener("DOMContentLoaded", () => void announce(), { once: true });
})();
