(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const STATE_KEY = "commerceOsShoplingStockStateSyncV013";
  const READY = "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY";
  const PING = "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING";
  const START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_START";
  const RESULT = "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT";
  const PROGRESS = "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS";
  const STATUS = "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS";
  const APPLY_OPTION_STATUS = "STOCK_SYNC_APPLY_OPTION_STATUS_V054";
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
    if (lastResult && Date.now() - Number(lastResult.finishedAt || 0) < 3_600_000) post({ type: RESULT, ...lastResult });
  }

  async function applyOptionStatusApi(job, goodsKey) {
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
        goodsKeys: [goodsKey],
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok || !payload?.result?.matchedGoodsKey) {
      throw new Error(payload?.message || `Shopling 옵션상태 API 처리 실패 (HTTP ${response.status})`);
    }
    const matchedGoodsKey = String(payload.result.matchedGoodsKey || "");
    if (matchedGoodsKey !== goodsKey) {
      throw new Error(`Shopling 옵션상태 API goods key 불일치: 요청 ${goodsKey} / 응답 ${matchedGoodsKey || "없음"}`);
    }
    return payload.result;
  }

  async function applyOptionStatusForDiscoveredGoodsKeys(job) {
    const goodsKeys = [...new Set(
      (Array.isArray(job?.goodsKeys) ? job.goodsKeys : [])
        .map((value) => String(value ?? "").trim())
        .filter((value) => /^\d+$/.test(value)),
    )];
    if (!goodsKeys.length) {
      return { ok: false, code: "OPTION_API_GOODS_KEYS_REQUIRED", message: "A6에서 확보한 Shopling 상품코드가 없습니다.", results: [] };
    }

    const results = [];
    for (let index = 0; index < goodsKeys.length; index += 1) {
      const goodsKey = goodsKeys[index];
      post({
        type: PROGRESS,
        jobId: job?.jobId || "",
        stage: "SHOPLING_OPTION_API",
        message: `${job?.barcode || "B코드"} · Shopling 상품코드 ${goodsKey} (${index + 1}/${goodsKeys.length}) 옵션상태를 API로 검증·적용합니다.`,
        job,
        goodsKey,
        goodsKeyIndex: index,
        goodsKeyCount: goodsKeys.length,
      });
      try {
        const result = await applyOptionStatusApi(job, goodsKey);
        results.push({
          goodsKey,
          matchedGoodsKey: String(result.matchedGoodsKey || ""),
          targetStatusCode: String(result.targetStatusCode || ""),
          statusBefore: String(result.statusBefore || ""),
          statusAfter: String(result.statusAfter || ""),
          optionQuantity: String(result.optionQuantity || ""),
          optionId: String(result.optionId || ""),
          mutated: Boolean(result.mutated),
          modifyCode: String(result.modifyCode || ""),
          verifiedAt: String(result.verifiedAt || ""),
        });
      } catch (error) {
        return {
          ok: false,
          code: results.length ? "SHOPLING_OPTION_API_PARTIAL_FAILED_RETRY_SAFE" : "SHOPLING_OPTION_API_FAILED",
          message: String(error?.message || error || "Shopling 옵션상태 API 처리에 실패했습니다."),
          failedGoodsKey: goodsKey,
          results,
          goodsKeys,
        };
      }
    }
    return { ok: true, results, goodsKeys };
  }

  async function startFromOps(rawJob) {
    const isOption = String(rawJob?.productKind || "").toUpperCase() === "OPTION";
    const job = isOption
      ? {
          ...rawJob,
          optionApiApplied: false,
          goodsKeySource: "A6_LIVE_OPTION_BARCODE",
          initialGoodsKeys: Array.isArray(rawJob?.goodsKeys) ? rawJob.goodsKeys : [],
        }
      : rawJob;

    if (isOption) {
      post({
        type: PROGRESS,
        jobId: job?.jobId || "",
        stage: "A6_LIVE_GOODSKEY_DISCOVERY",
        message: `${job?.barcode || "B코드"} · A6 옵션자체관리코드 최대기간 검색에서 상품코드만 읽습니다. 체크/상태변경은 하지 않습니다.`,
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
      evidence: { code: response?.code || "STOCK_SYNC_START_FAILED", missing: response?.missing || [], goodsKeySource: isOption ? "A6_LIVE_OPTION_BARCODE" : null },
      finishedAt: Date.now(),
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === PING) { void announce(); return; }
    if (data.type !== START) return;
    void startFromOps(data.job).catch((error) => {
      post({
        type: RESULT,
        jobId: data.job?.jobId || "",
        job: data.job || null,
        outcome: "FAILED",
        message: String(error?.message || error || "Shopling 확장프로그램 통신 실패"),
        evidence: { code: "SHOPLING_A6_LIVE_OR_RUNTIME_FAILED" },
        finishedAt: Date.now(),
      });
    });
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "STOCK_SYNC_PROGRESS") {
      post({ type: PROGRESS, ...message.payload });
      return;
    }
    if (message?.type === "STOCK_SYNC_RESULT") {
      post({ type: RESULT, ...message.payload });
      return;
    }
    if (message?.type !== APPLY_OPTION_STATUS) return;
    void applyOptionStatusForDiscoveredGoodsKeys(message.job)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, code: "SHOPLING_OPTION_API_BRIDGE_FAILED", message: String(error?.message || error || "옵션상태 API bridge 실패"), results: [] }));
    return true;
  });
  void announce();
  window.addEventListener("DOMContentLoaded", () => void announce(), { once: true });
})();
