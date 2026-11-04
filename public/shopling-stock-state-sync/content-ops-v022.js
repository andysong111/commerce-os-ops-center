(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const STATE_KEY = "commerceOsShoplingStockStateSyncV013";
  const READY = "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY";
  const PING = "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING";
  const START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_START";
  const RESULT = "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT";
  const PROGRESS = "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS";
  const STATUS = "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS";
  const API_PATH = "/api/inventory-stock-control/shopling-option-status";
  const post = (payload) =>
    window.postMessage({ ...payload, extensionVersion: VERSION }, location.origin);

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
      post({ type: RESULT, ...lastResult });
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

  async function startFromOps(rawJob) {
    let result;
    try {
      result = await applyStockStateApi(rawJob);
    } catch (error) {
      post({
        type: RESULT,
        jobId: rawJob?.jobId || "",
        job: rawJob || null,
        outcome: "FAILED",
        message: String(error?.message || error || "Shopling API 상태 검증 실패"),
        evidence: { code: "SHOPLING_STOCK_STATE_API_FAILED", browserMutationStarted: false },
        finishedAt: Date.now(),
      });
      return;
    }

    const job = {
      ...rawJob,
      goodsKeys: result.goodsKeys,
      stockStateApiApplied: true,
      optionApiApplied: String(rawJob?.productKind || "").toUpperCase() === "OPTION",
      productStatusApiApplied: String(rawJob?.productKind || "").toUpperCase() === "SINGLE",
      goodsKeySource: "SHOPLING_BCODE_API_INDEX",
      stockStateApiEvidence: result.receipts,
    };
    const response = await chrome.runtime.sendMessage({ type: "STOCK_SYNC_START", job });
    if (response?.ok) {
      post({
        type: PROGRESS,
        jobId: job.jobId,
        stage: response.active?.stage || "A21_LIST",
        message: response.message || "Shopling API 검증 완료 · A21 전송을 시작했습니다.",
        job: response.active?.job || job,
        apiVerifiedGoodsKeys: result.goodsKeys,
        apiReceipts: result.receipts,
      });
      return;
    }
    post({
      type: RESULT,
      jobId: job.jobId,
      job,
      outcome: "FAILED",
      message: response?.message || "A21 전송을 시작하지 못했습니다.",
      evidence: {
        code: response?.code || "STOCK_SYNC_START_FAILED",
        missing: response?.missing || [],
        apiReceipts: result.receipts,
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
        message: String(error?.message || error || "Shopling 확장프로그램 통신 실패"),
        evidence: { code: "SHOPLING_API_FIRST_RUNTIME_FAILED" },
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
