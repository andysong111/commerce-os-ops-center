importScripts("background-v078.js");

// HF57 narrows the Commerce OS responsibility boundary to the event the owner
// requested: Shopling has accepted the A21 transmission and navigated the
// exact popup to its result page. Marketplace-by-marketplace completion stays
// in Shopling and must not hold the next B-code for minutes.
(() => {
  const VERSION_V079 = chrome.runtime.getManifest().version;
  const RESULT_PATH = "/prod_a/prod_status_trsmt.phtml";
  // Beat the legacy 250 ms parallel coordinator poll so result navigation is
  // acknowledged before it can detach the tab and keep waiting for market results.
  const ACK_DELAY_MS = 25;
  const acknowledgements = new Set();

  function exactResultUrl(raw) {
    try {
      const url = new URL(String(raw || ""));
      return (
        (url.hostname === "shopling.co.kr" ||
          url.hostname.endsWith(".shopling.co.kr")) &&
        url.pathname.toLowerCase() === RESULT_PATH
      );
    } catch {
      return false;
    }
  }

  function finalOptionBatchSubmitted(active) {
    if (String(active?.job?.productKind || "").toUpperCase() !== "OPTION") {
      return true;
    }
    if (active?.job?.optionApiApplied !== true) return false;
    const goodsKeys = Array.isArray(active?.job?.goodsKeys)
      ? active.job.goodsKeys
      : [];
    const currentBatch = Array.isArray(active?.optionCurrentBatchKeys)
      ? active.optionCurrentBatchKeys
      : [];
    const batchStart = Math.max(
      0,
      Number(active?.optionCurrentBatchStart ?? active?.goodsKeyIndex ?? 0),
    );
    return (
      goodsKeys.length > 0 &&
      currentBatch.length > 0 &&
      batchStart + currentBatch.length >= goodsKeys.length
    );
  }

  async function acknowledgeDispatch(trigger, tabId, rawUrl, windowId = null) {
    if (!Number.isInteger(tabId) || !exactResultUrl(rawUrl)) return false;
    const active = await loadActive();
    if (!active || active.status !== "RUNNING") return false;
    if (
      !["A21_LIST", "A21_POPUP", "WAIT_A21_RESULT"].includes(
        String(active.stage || ""),
      )
    ) {
      return false;
    }
    if (!finalOptionBatchSubmitted(active)) return false;

    const key = `${active.job?.jobId || "unknown"}:${tabId}`;
    if (acknowledgements.has(key)) return true;
    acknowledgements.add(key);
    try {
      const latest = await loadActive();
      if (
        !latest ||
        latest.status !== "RUNNING" ||
        latest.job?.jobId !== active.job?.jobId ||
        !finalOptionBatchSubmitted(latest)
      ) {
        return false;
      }

      latest.stage = "WAIT_A21_RESULT";
      latest.stageStartedAt = Date.now();
      latest.shoplingDispatchAcceptedAt = Date.now();
      latest.shoplingDispatchResultTabId = tabId;
      latest.shoplingDispatchResultWindowId = Number.isInteger(windowId)
        ? windowId
        : null;
      latest.shoplingDispatchResultUrl = String(rawUrl || "");
      await saveActive(latest);

      await finish(
        latest,
        "SUCCEEDED",
        `${latest.job.barcode} · Shopling이 ${statusKorean(latest.job.desiredStatus)} 전송을 접수해 실제 결과페이지를 시작했습니다. 마켓별 최종 결과는 Shopling에서 계속 처리됩니다.`,
        {
          code: "SHOPLING_DISPATCH_ACCEPTED_HF57",
          stage: "WAIT_A21_RESULT",
          shoplingDispatchAccepted: true,
          commerceOsResponsibilityComplete: true,
          marketplaceCompletionRequired: false,
          marketFailuresAdvisory: true,
          resultNavigationTrigger: trigger,
          resultTabId: tabId,
          resultWindowId: Number.isInteger(windowId) ? windowId : null,
          resultUrl: String(rawUrl || ""),
          extensionVersion: VERSION_V079,
        },
      );
      return true;
    } finally {
      setTimeout(() => acknowledgements.delete(key), 30_000);
    }
  }

  function schedule(trigger, tabId, rawUrl, windowId) {
    if (!Number.isInteger(tabId) || !exactResultUrl(rawUrl)) return;
    setTimeout(
      () => void acknowledgeDispatch(trigger, tabId, rawUrl, windowId),
      ACK_DELAY_MS,
    );
  }

  chrome.tabs.onCreated.addListener((tab) =>
    schedule(
      "tabs.onCreated",
      tab?.id,
      String(tab?.pendingUrl || tab?.url || ""),
      tab?.windowId,
    ),
  );
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) =>
    schedule(
      "tabs.onUpdated",
      tabId,
      String(changeInfo?.url || tab?.url || tab?.pendingUrl || ""),
      tab?.windowId,
    ),
  );
  chrome.webNavigation?.onCommitted?.addListener((details) =>
    schedule(
      "webNavigation.onCommitted",
      details?.tabId,
      String(details?.url || ""),
      null,
    ),
  );
  chrome.webNavigation?.onCompleted?.addListener((details) =>
    schedule(
      "webNavigation.onCompleted",
      details?.tabId,
      String(details?.url || ""),
      null,
    ),
  );
})();
