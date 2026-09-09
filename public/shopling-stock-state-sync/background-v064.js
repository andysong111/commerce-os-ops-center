importScripts("background-v060.js");

// HF23: direct bridge for the REAL Shopling sale-status result host observed live:
//   aapi*.shopling.co.kr:<port>/prod_a/prod_status_trsmt.phtml
//
// Start from HF19 so A6 max-pagination, A21 200-row batching, HF10 OPTION and every
// previously proven stock core remain, but do not start the unsuccessful HF20-HF22
// SINGLE result watchers in parallel. The direct cross-host result script is now the
// single authority for SINGLE completion. It ACKs first, then copies the live price
// extension's completeJob -> closeManaged policy and removes the actual managed windows.
(() => {
  const VERSION_V064 = chrome.runtime.getManifest().version;
  const RESULT_MESSAGE_V064 = "STOCK_SINGLE_STATUS_RESULT_TERMINAL_V023";
  const WORKSPACE_KEY_V064 = "commerceStockWorkspaceV030";
  const locksV064 = new Set();

  function isSingleWaitV064(active) {
    return Boolean(
      active &&
      active.status === "RUNNING" &&
      active.job?.productKind === "SINGLE" &&
      active.stage === "WAIT_A21_RESULT"
    );
  }

  function exactResultUrlV064(raw) {
    try {
      const url = new URL(String(raw || ""));
      const hostOk = url.hostname === "shopling.co.kr" || url.hostname.endsWith(".shopling.co.kr");
      return hostOk && /\/prod_a\/prod_status_trsmt\.phtml$/i.test(url.pathname);
    } catch {
      return false;
    }
  }

  async function removeWindowVerifiedV064(windowId) {
    if (!Number.isInteger(windowId)) return { closed: false, mode: "NO_WINDOW" };
    const before = await chrome.windows.get(windowId).catch(() => null);
    if (!before) return { closed: true, mode: "ALREADY_GONE", windowId };
    await chrome.windows.remove(windowId).catch(() => null);
    const after = await chrome.windows.get(windowId).catch(() => null);
    return { closed: !after, mode: !after ? "WINDOW" : "WINDOW_REMOVE_FAILED", windowId };
  }

  async function closeManagedPriceStyleV064({ resultTabId, resultWindowId, originalPopupTabId, originalPopupWindowId }) {
    // Literal price-extension policy: close managed popup windows, not just a guessed DOM tab.
    const windowIds = [...new Set([resultWindowId, originalPopupWindowId].filter(Number.isInteger))];
    const results = [];
    for (const windowId of windowIds) results.push(await removeWindowVerifiedV064(windowId));

    // Fallback for an unusual shared-window/result-tab case.
    for (const tabId of [...new Set([resultTabId, originalPopupTabId].filter(Number.isInteger))]) {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) continue;
      if (windowIds.includes(tab.windowId) && results.some((row) => row.windowId === tab.windowId && row.closed)) continue;
      await chrome.tabs.remove(tabId).catch(() => null);
      results.push({ closed: !(await chrome.tabs.get(tabId).catch(() => null)), mode: "TAB_FALLBACK", tabId, windowId: tab.windowId });
    }
    return results;
  }

  async function closeOwnedWorkersAfterFinalV064(excludedWindowIds = []) {
    const stored = await chrome.storage.local.get(WORKSPACE_KEY_V064).catch(() => ({}));
    const ws = stored?.[WORKSPACE_KEY_V064] || null;
    if (!ws) return [];
    const excluded = new Set(excludedWindowIds.filter(Number.isInteger));
    const ids = new Set();
    for (const target of Object.values(ws.targets || {})) {
      if (!target || target.owned === false) continue;
      if (Number.isInteger(target.windowId)) {
        if (!excluded.has(target.windowId)) ids.add(target.windowId);
        continue;
      }
      if (Number.isInteger(target.tabId)) {
        const tab = await chrome.tabs.get(target.tabId).catch(() => null);
        if (Number.isInteger(tab?.windowId) && !excluded.has(tab.windowId)) ids.add(tab.windowId);
      }
    }
    const closed = [];
    for (const windowId of ids) {
      const result = await removeWindowVerifiedV064(windowId);
      if (result.closed) closed.push(windowId);
    }
    return closed;
  }

  async function clearPopupTrackingIfStillRunningV064(jobId, tabIds, windowIds) {
    const remaining = await loadActive();
    if (!remaining || remaining.status !== "RUNNING" || remaining.job?.jobId !== jobId) return remaining;
    if (tabIds.includes(remaining.singlePopupTabId)) remaining.singlePopupTabId = null;
    if (windowIds.includes(remaining.singlePopupWindowId)) remaining.singlePopupWindowId = null;
    if (tabIds.includes(remaining.workTabs?.A21_POPUP?.tabId)) {
      const nextTabs = { ...(remaining.workTabs || {}) };
      delete nextTabs.A21_POPUP;
      remaining.workTabs = nextTabs;
    }
    await saveActive(remaining);
    return remaining;
  }

  async function handleDirectResultV064(message, sender) {
    const active = await loadActive();
    if (!isSingleWaitV064(active)) return { ok: false, noActiveJob: true, accepted: false };

    const evidence = message?.evidence || {};
    const senderTabId = sender?.tab?.id;
    const senderWindowId = sender?.tab?.windowId;
    const senderUrl = String(evidence.href || sender?.tab?.url || "");
    if (!Number.isInteger(senderTabId) || !Number.isInteger(senderWindowId) || !exactResultUrlV064(senderUrl)) {
      return { ok: false, accepted: false, error: "hf23_result_sender_not_exact_status_page" };
    }
    if (evidence.processing || evidence.readyState !== "complete" || !(evidence.exactFooter || evidence.fallbackFooter)) {
      return { ok: false, accepted: false, error: "hf23_result_not_terminal" };
    }
    if (Number(evidence.stableMs || 0) < 2_000) {
      return { ok: false, accepted: false, error: "hf23_result_not_stable" };
    }

    const lockKey = String(active.job?.jobId || "");
    if (locksV064.has(lockKey)) return { ok: true, accepted: true, duplicate: true };
    locksV064.add(lockKey);

    const originalPopupTabId = Number.isInteger(active.singlePopupTabId) ? active.singlePopupTabId : null;
    const originalPopupWindowId = Number.isInteger(active.singlePopupWindowId) ? active.singlePopupWindowId : null;
    try {
      // Adopt the exact cross-host result as the managed result target before finalizing.
      active.singlePopupTabId = senderTabId;
      active.singlePopupWindowId = senderWindowId;
      active.workTabs = {
        ...(active.workTabs || {}),
        A21_POPUP: { tabId: senderTabId, frameId: Number.isInteger(sender?.frameId) ? sender.frameId : 0 },
      };
      await saveActive(active);

      const completionEvidence = {
        processing: false,
        productComplete: true,
        readyState: "complete",
        stableCompletionVerified: true,
        stableCompletionMs: Number(evidence.stableMs || 0),
        shoplingBatchComplete: true,
        exactProductStateFooterVerified: Boolean(evidence.exactFooter),
        exactProductStateFooterText: evidence.exactFooter
          ? "상품상태 변경 전송이 완료되었습니다."
          : "판매상태/상품수정 완료 footer",
        countsBalanced: Boolean(evidence.countsBalanced),
        successCount: Number(evidence.successCount || 0),
        failureCount: Number(evidence.failureCount || 0),
        marketFailureCount: Number(evidence.failureCount || 0),
        marketFailuresAdvisory: Number(evidence.failureCount || 0) > 0,
        explicitFailure: false,
        resultHost: String(evidence.hostname || ""),
        resultPath: String(evidence.pathname || ""),
        completionWatcher: "HF23_DIRECT_AAPI_RESULT_CLOSEMANAGED",
      };

      await progress(active, `A21 단품 · 실제 ${evidence.hostname || "Shopling 결과호스트"} 완료 footer 직접확인 → 가격조정 closeManaged 방식으로 ACK 후 창 종료`, {
        completionWatcher: completionEvidence.completionWatcher,
        resultTabId: senderTabId,
        resultWindowId: senderWindowId,
        originalPopupTabId,
        originalPopupWindowId,
        resultUrl: senderUrl,
        stableMs: completionEvidence.stableCompletionMs,
        countsBalanced: completionEvidence.countsBalanced,
        successCount: completionEvidence.successCount,
        failureCount: completionEvidence.failureCount,
        ackBeforeClose: true,
      });

      const advanced = await continueNextGoodsKey(
        active,
        { tab: { id: senderTabId, windowId: senderWindowId }, frameId: Number.isInteger(sender?.frameId) ? sender.frameId : 0 },
        completionEvidence,
      );

      // Copy the proven price-extension completion order: state success first, then closeManaged.
      const closeResults = await closeManagedPriceStyleV064({
        resultTabId: senderTabId,
        resultWindowId: senderWindowId,
        originalPopupTabId,
        originalPopupWindowId,
      });

      const tabIds = [senderTabId, originalPopupTabId].filter(Number.isInteger);
      const windowIds = [senderWindowId, originalPopupWindowId].filter(Number.isInteger);
      const remaining = await clearPopupTrackingIfStillRunningV064(active.job.jobId, tabIds, windowIds);
      let closedWorkerWindows = [];
      if (!remaining || remaining.status !== "RUNNING" || remaining.job?.jobId !== active.job.jobId) {
        closedWorkerWindows = await closeOwnedWorkersAfterFinalV064(windowIds);
      }

      return {
        ok: true,
        accepted: true,
        advanced,
        closeResults,
        closedWorkerWindows,
        watcher: completionEvidence.completionWatcher,
        version: VERSION_V064,
      };
    } finally {
      locksV064.delete(lockKey);
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== RESULT_MESSAGE_V064) return undefined;
    void handleDirectResultV064(message, sender)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, accepted: false, error: String(error?.message || error || "HF23 direct result failure") }));
    return true;
  });
})();
