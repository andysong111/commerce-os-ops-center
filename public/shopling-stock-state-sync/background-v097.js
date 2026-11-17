importScripts("background-v096.js");

// HF87 treats Shopling's balanced result table as the authoritative receipt.
// A stale "processing" overlay may remain above an already completed table, so
// completion is based on stable per-table totals rather than that overlay text.
(() => {
  const VERSION_HF87 = chrome.runtime.getManifest().version;
  const WATCH_ALARM_HF87 = "commerceOsShoplingStockHf87ReceiptWatch";
  const stableReceiptsHf87 = new Map();
  let watchingHf87 = false;

  function resultTableEvidenceHf87(textValue, readyState = "complete") {
    const text = String(textValue ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
    const numbers = (pattern) =>
      [...text.matchAll(pattern)].map((match) => Number(String(match[1] || "0").replace(/,/g, "")));
    const totals = numbers(/총건수\s*[:：]?\s*([\d,]+)/gi);
    const successes = numbers(/성공건수\s*[:：]?\s*([\d,]+)/gi);
    const failures = numbers(/실패건수\s*[:：]?\s*([\d,]+)/gi);
    const resultHeading =
      /쇼핑몰\s*상품(?:옵션\s*수정|상태\s*변경)\s*전송\s*결과입니다/i.test(text) ||
      /상품(?:옵션|상태)\s*(?:수정|변경)?\s*전송\s*결과입니다/i.test(text);
    const sameShape =
      totals.length > 0 &&
      totals.length === successes.length &&
      totals.length === failures.length;
    const rowsBalanced =
      sameShape && totals.every((total, index) => total === successes[index] + failures[index]);
    const totalCount = totals.reduce((sum, value) => sum + value, 0);
    const successCount = successes.reduce((sum, value) => sum + value, 0);
    const failureCount = failures.reduce((sum, value) => sum + value, 0);
    const terminal =
      readyState === "complete" &&
      resultHeading &&
      rowsBalanced &&
      totalCount > 0;
    return {
      authoritative:
        terminal &&
        successCount > 0 &&
        failureCount === 0,
      terminal,
      resultHeading,
      rowsBalanced,
      totalCount,
      successCount,
      failureCount,
      resultSectionCount: totals.length,
      processingOverlayPresent:
        /처리중입니다|잠시만\s*기다려주시기\s*바랍니다/i.test(text),
      readyState,
      signature: [totals.join(","), successes.join(","), failures.join(",")].join("|"),
      textSample: text.slice(-1200),
    };
  }

  function probeResultDocumentHf87() {
    const text = String(
      document.body?.innerText ||
        document.body?.textContent ||
        document.documentElement?.innerText ||
        "",
    );
    const normalized = text.normalize("NFKC").replace(/\s+/g, " ").trim();
    const numbers = (pattern) =>
      [...normalized.matchAll(pattern)].map((match) => Number(String(match[1] || "0").replace(/,/g, "")));
    const totals = numbers(/총건수\s*[:：]?\s*([\d,]+)/gi);
    const successes = numbers(/성공건수\s*[:：]?\s*([\d,]+)/gi);
    const failures = numbers(/실패건수\s*[:：]?\s*([\d,]+)/gi);
    const resultHeading =
      /쇼핑몰\s*상품(?:옵션\s*수정|상태\s*변경)\s*전송\s*결과입니다/i.test(normalized) ||
      /상품(?:옵션|상태)\s*(?:수정|변경)?\s*전송\s*결과입니다/i.test(normalized);
    const sameShape =
      totals.length > 0 &&
      totals.length === successes.length &&
      totals.length === failures.length;
    const rowsBalanced =
      sameShape && totals.every((total, index) => total === successes[index] + failures[index]);
    const totalCount = totals.reduce((sum, value) => sum + value, 0);
    const successCount = successes.reduce((sum, value) => sum + value, 0);
    const failureCount = failures.reduce((sum, value) => sum + value, 0);
    const terminal =
      document.readyState === "complete" &&
      resultHeading &&
      rowsBalanced &&
      totalCount > 0;
    return {
      authoritative:
        terminal &&
        successCount > 0 &&
        failureCount === 0,
      terminal,
      resultHeading,
      rowsBalanced,
      totalCount,
      successCount,
      failureCount,
      resultSectionCount: totals.length,
      processingOverlayPresent:
        /처리중입니다|잠시만\s*기다려주시기\s*바랍니다/i.test(normalized),
      readyState: String(document.readyState || ""),
      signature: [totals.join(","), successes.join(","), failures.join(",")].join("|"),
      textSample: normalized.slice(-1200),
      href: String(location.href || ""),
      title: String(document.title || ""),
    };
  }

  function ownerTabIdsHf87(active) {
    const listTabId = Number(
      active?.a21ExecutionWorkerHf76?.tabId ??
        active?.workTabs?.A21_LIST?.tabId ??
        active?.shoplingTabId,
    );
    const popupTabId = Number(
      active?.workTabs?.A21_POPUP?.tabId ??
        active?.lastMileReceiptHf84?.popupTabId ??
        active?.lastMileReceiptHf83?.popupTabId ??
        active?.lastMileReceiptHf82?.popupTabId ??
        active?.singlePopupTabId,
    );
    return {
      listTabId: Number.isInteger(listTabId) ? listTabId : null,
      popupTabId: Number.isInteger(popupTabId) ? popupTabId : null,
    };
  }

  function shoplingUrlHf87(value) {
    try {
      const url = new URL(String(value || ""));
      return url.hostname === "shopling.co.kr" || url.hostname.endsWith(".shopling.co.kr");
    } catch {
      return false;
    }
  }

  async function candidateTabsHf87(active) {
    const { listTabId, popupTabId } = ownerTabIdsHf87(active);
    if (!Number.isInteger(popupTabId)) return [];
    const baseline = new Set(
      (active?.shoplingResultBaselineTabIdsHf72 || []).map(Number).filter(Number.isInteger),
    );
    const tabs = await chrome.tabs.query({}).catch(() => []);
    return tabs.filter((tab) => {
      const tabId = Number(tab?.id);
      if (!Number.isInteger(tabId) || baseline.has(tabId)) return false;
      if (!shoplingUrlHf87(tab?.url || tab?.pendingUrl)) return false;
      if (tabId === popupTabId) return true;
      const opener = Number(tab?.openerTabId);
      return opener === popupTabId || (Number.isInteger(listTabId) && opener === listTabId);
    });
  }

  function stableKeyHf87(active, tabId, signature) {
    return [
      String(active?.job?.jobId || ""),
      Number(active?.stockStateGroupIndexHf72 || 0),
      Number(active?.goodsKeyIndex || 0),
      tabId,
      signature,
    ].join(":");
  }

  async function closeCompletedWindowsHf87(active, candidateTabId, acceptedPopupTabId) {
    const { listTabId } = ownerTabIdsHf87(active);
    const closing = [...new Set([candidateTabId, acceptedPopupTabId])]
      .map(Number)
      .filter((tabId) => Number.isInteger(tabId) && tabId !== listTabId);
    if (closing.length) await chrome.tabs.remove(closing).catch(() => null);
  }

  async function watchResultHf87(trigger) {
    if (watchingHf87) return false;
    watchingHf87 = true;
    try {
      const active = await loadActive().catch(() => null);
      if (
        !active ||
        active.status !== "RUNNING" ||
        active.stage !== "WAIT_A21_RESULT"
      ) {
        return false;
      }
      const { popupTabId } = ownerTabIdsHf87(active);
      if (!Number.isInteger(popupTabId)) return false;
      const candidates = await candidateTabsHf87(active);
      for (const tab of candidates) {
        const tabId = Number(tab?.id);
        const frames = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: probeResultDocumentHf87,
        }).catch(() => []);
        const evidence = frames
          .map((frame) => frame?.result)
          .find((result) => result?.terminal === true);
        if (!evidence) continue;

        const stableKey = stableKeyHf87(active, tabId, evidence.signature);
        const firstSeenAt = Number(stableReceiptsHf87.get(stableKey) || 0);
        if (!firstSeenAt) {
          stableReceiptsHf87.set(stableKey, Date.now());
          setTimeout(() => void watchResultHf87("stable-result-recheck"), 700);
          return false;
        }
        if (Date.now() - firstSeenAt < 600) continue;

        const latest = await loadActive().catch(() => null);
        if (
          !latest ||
          latest.status !== "RUNNING" ||
          latest.stage !== "WAIT_A21_RESULT" ||
          latest.job?.jobId !== active.job?.jobId
        ) {
          return false;
        }
        const receiptEvidence = {
          ...evidence,
          optionComplete: true,
          productComplete: true,
          sharedStateComplete: true,
          explicitFailure: Number(evidence.failureCount || 0) > 0,
          exactOwnerA21PopupTabId: popupTabId,
          exactOwnerResultTabId: tabId,
          completionPolicy: "HF87_STABLE_BALANCED_SHOPLING_RESULT_TABLE",
          acceptanceTrigger: trigger,
          extensionVersion: VERSION_HF87,
        };
        const advanced = evidence.authoritative === true
          ? await continueNextGoodsKey(
              latest,
              { tab: { id: tabId, windowId: tab?.windowId }, frameId: 0 },
              receiptEvidence,
            )
          : {
              ok: true,
              result: await finish(
                latest,
                "UNCERTAIN",
                String(latest.job?.barcode || "B코드")
                  + " · Shopling 결과표에 실패 "
                  + Number(evidence.failureCount || 0)
                  + "건이 확인되어 자동 성공 처리하지 않았습니다.",
                {
                  code: "SHOPLING_HF87_RESULT_TABLE_FAILURE",
                  result: receiptEvidence,
                  resultTabId: tabId,
                  resultFrameId: 0,
                  retrySafe: false,
                },
              ),
            };
        if (advanced?.ok === true) {
          await closeCompletedWindowsHf87(latest, tabId, popupTabId);
          return true;
        }
      }
      return false;
    } finally {
      watchingHf87 = false;
    }
  }

  function scheduleHf87(trigger) {
    setTimeout(() => void watchResultHf87(trigger), 120);
    setTimeout(() => void watchResultHf87(`${trigger}-900ms`), 900);
  }

  chrome.tabs.onUpdated.addListener(() => scheduleHf87("tabs.onUpdated"));
  chrome.tabs.onCreated.addListener(() => scheduleHf87("tabs.onCreated"));
  chrome.webNavigation?.onCompleted?.addListener(() => scheduleHf87("webNavigation.onCompleted"));
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name === WATCH_ALARM_HF87) void watchResultHf87("receipt-watch-alarm");
  });
  chrome.alarms.create(WATCH_ALARM_HF87, { periodInMinutes: 0.5 });
  setInterval(() => void watchResultHf87("receipt-watch-interval"), 850);

  if (globalThis.__COMMERCE_OS_EXPOSE_STOCK_HF87_TEST_HOOKS__ === true) {
    globalThis.__commerceOsStockHf87TestHooks = {
      resultTableEvidenceHf87,
      stableKeyHf87,
    };
  }
})();
