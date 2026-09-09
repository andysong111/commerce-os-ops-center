importScripts("background-v059.js");

// HF19: SINGLE sale-status result ACK first, then managed auto-close.
// The Shopling result page may render terminal per-market counts without the legacy footer,
// and it may navigate/open into a different result tab than the original transmit popup.
(() => {
  const VERSION_V060 = chrome.runtime.getManifest().version;
  const STABLE_MS_V060 = 2_500;
  const POLL_MS_V060 = 450;
  const WAIT_MS_V060 = 45_000;
  const watchersV060 = new Set();
  const legacyHandleEvidenceV060 = handleEvidence;

  function isSingleResultWaitV060(active) {
    return Boolean(
      active &&
      active.status === "RUNNING" &&
      active.job?.productKind === "SINGLE" &&
      active.stage === "WAIT_A21_RESULT"
    );
  }

  async function inspectTerminalV060(tabId) {
    if (!Number.isInteger(tabId)) return { ok: false, code: "HF19_RESULT_TAB_MISSING" };
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return { ok: false, code: "HF19_RESULT_TAB_GONE" };
    const rows = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
        const text = norm(document.body?.innerText || document.body?.textContent || document.documentElement?.innerText || "");
        const totals = [...text.matchAll(/총건수\s*[:：]?\s*([\d,]+)/gi)].map((match) => Number(match[1].replace(/,/g, "")));
        const successes = [...text.matchAll(/성공건수\s*[:：]?\s*([\d,]+)/gi)].map((match) => Number(match[1].replace(/,/g, "")));
        const failures = [...text.matchAll(/실패건수\s*[:：]?\s*([\d,]+)/gi)].map((match) => Number(match[1].replace(/,/g, "")));
        const terminalCounts =
          totals.length > 0 &&
          totals.length === successes.length &&
          totals.length === failures.length &&
          totals.every((total, index) => total === successes[index] + failures[index]);
        const footer =
          /상품\s*수정\s*전송이\s*완료되었습니다/i.test(text) ||
          /상품판매상태\s*송신이\s*완료되었습니다/i.test(text);
        return {
          processing: /처리중입니다/i.test(text) || /잠시만\s*기다려주시기\s*바랍니다/i.test(text),
          terminal: terminalCounts || footer,
          terminalCounts,
          footer,
          totalBlocks: totals.length,
          successBlocks: successes.length,
          failureBlocks: failures.length,
          failureCount: failures.reduce((sum, value) => sum + value, 0),
          readyState: String(document.readyState || ""),
          href: String(location.href || ""),
          title: String(document.title || ""),
        };
      },
    }).catch(() => []);
    const values = rows.map((row) => row?.result).filter(Boolean);
    const terminalReady = values.some((row) => row.terminal && row.readyState === "complete");
    return {
      ok: values.length > 0,
      processing: values.some((row) => row.processing),
      terminal: values.some((row) => row.terminal),
      terminalReady,
      terminalCounts: values.some((row) => row.terminalCounts),
      footer: values.some((row) => row.footer),
      failureCount: Math.max(0, ...values.map((row) => Number(row.failureCount || 0))),
      frames: values,
    };
  }

  async function closeManagedResultV060(tabId, active) {
    if (!Number.isInteger(tabId)) return { closed: false, mode: "NO_TAB" };
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return { closed: true, mode: "ALREADY_GONE" };

    const protectedTabIds = new Set();
    for (const [stage, value] of Object.entries(active?.workTabs || {})) {
      if (stage === "A21_POPUP") continue;
      if (Number.isInteger(value?.tabId)) protectedTabIds.add(value.tabId);
    }
    if (protectedTabIds.has(tabId)) return { closed: false, mode: "PROTECTED_WORK_TAB", tabId };

    const tabsInWindow = Number.isInteger(tab.windowId)
      ? await chrome.tabs.query({ windowId: tab.windowId }).catch(() => [])
      : [];
    const protectedSameWindow = tabsInWindow.some((row) => protectedTabIds.has(row.id));
    if (Number.isInteger(tab.windowId) && tabsInWindow.length === 1 && !protectedSameWindow) {
      await chrome.windows.remove(tab.windowId).catch(() => null);
      return { closed: true, mode: "WINDOW", windowId: tab.windowId, tabId };
    }
    await chrome.tabs.remove(tabId).catch(() => null);
    return { closed: true, mode: "TAB", windowId: tab.windowId, tabId };
  }

  async function runWatcherV060(activeSnapshot, sender, initialEvidence) {
    const tabId = sender?.tab?.id;
    if (!Number.isInteger(tabId)) return false;
    const goodsKey = currentGoodsKey(activeSnapshot);
    const key = `${activeSnapshot.job.jobId}:${goodsKey || "none"}:${tabId}`;
    if (watchersV060.has(key)) return true;
    watchersV060.add(key);

    const startedAt = Date.now();
    let stableSince = 0;
    let lastProbe = null;
    try {
      while (Date.now() - startedAt < WAIT_MS_V060) {
        const latest = await loadActive();
        if (!isSingleResultWaitV060(latest) || latest.job?.jobId !== activeSnapshot.job?.jobId || currentGoodsKey(latest) !== goodsKey) {
          return false;
        }
        const probe = await inspectTerminalV060(tabId);
        lastProbe = probe;
        if (!probe.ok || probe.processing || !probe.terminal || !probe.terminalReady) {
          stableSince = 0;
          await sleep(POLL_MS_V060);
          continue;
        }
        if (!stableSince) stableSince = Date.now();
        const stableMs = Date.now() - stableSince;
        if (stableMs < STABLE_MS_V060) {
          await sleep(POLL_MS_V060);
          continue;
        }

        const completionEvidence = {
          ...(initialEvidence || {}),
          processing: false,
          productComplete: true,
          readyState: "complete",
          stableCompletionVerified: true,
          stableCompletionMs: stableMs,
          shoplingBatchComplete: true,
          completionWatcher: "HF19_SINGLE_RESULT_COUNTS_ACK_THEN_AUTOCLOSE",
          terminalCountsVerified: Boolean(probe.terminalCounts),
          marketFailureCount: Number(probe.failureCount || initialEvidence?.failureCount || 0),
          marketFailuresAdvisory: Number(probe.failureCount || initialEvidence?.failureCount || 0) > 0,
          explicitFailure: false,
        };

        await progress(latest, `A21 단품 goods key ${goodsKey} · 최종 결과 ${stableMs}ms 안정화 → 성공 ACK 후 결과창 자동닫기`, {
          completionWatcher: completionEvidence.completionWatcher,
          resultTabId: tabId,
          terminalCountsVerified: completionEvidence.terminalCountsVerified,
          marketFailureCount: completionEvidence.marketFailureCount,
          ackBeforeClose: true,
        });

        const advanced = await continueNextGoodsKey(
          latest,
          { tab: { id: tabId, windowId: sender?.tab?.windowId }, frameId: Number.isInteger(sender?.frameId) ? sender.frameId : 0 },
          completionEvidence,
        );
        const closeResult = await closeManagedResultV060(tabId, latest);

        const remaining = await loadActive();
        if (remaining?.status === "RUNNING" && remaining.job?.jobId === activeSnapshot.job?.jobId) {
          if (remaining.singlePopupTabId === tabId) remaining.singlePopupTabId = null;
          if (remaining.singlePopupWindowId === sender?.tab?.windowId) remaining.singlePopupWindowId = null;
          if (remaining.workTabs?.A21_POPUP?.tabId === tabId) {
            const nextTabs = { ...(remaining.workTabs || {}) };
            delete nextTabs.A21_POPUP;
            remaining.workTabs = nextTabs;
          }
          await saveActive(remaining);
        }
        return { ok: true, advanced, closeResult };
      }

      const latest = await loadActive();
      if (isSingleResultWaitV060(latest) && latest.job?.jobId === activeSnapshot.job?.jobId) {
        await progress(latest, `A21 단품 goods key ${goodsKey} · HF19 최종 결과 안정화 시간초과`, {
          code: "HF19_SINGLE_RESULT_STABILITY_TIMEOUT",
          resultTabId: tabId,
          lastProbe,
        });
      }
      return false;
    } finally {
      watchersV060.delete(key);
    }
  }

  handleEvidence = async function handleEvidenceV060(message, sender) {
    const active = await loadActive();
    if (!isSingleResultWaitV060(active)) return legacyHandleEvidenceV060(message, sender);
    const evidence = message?.evidence || {};
    const tabId = sender?.tab?.id;
    const terminalHint =
      Number.isInteger(tabId) &&
      !evidence.processing &&
      evidence.readyState === "complete" &&
      Boolean(evidence.productComplete || evidence.shoplingBatchComplete);
    if (!terminalHint) return legacyHandleEvidenceV060(message, sender);

    // Shopling may transition the submit popup into a new result tab/window. Adopt the
    // terminal sender as the managed result target instead of discarding it as a tab mismatch.
    if (active.singlePopupTabId !== tabId || active.singlePopupWindowId !== sender?.tab?.windowId) {
      active.singlePopupTabId = tabId;
      active.singlePopupWindowId = sender?.tab?.windowId ?? null;
      active.workTabs = { ...(active.workTabs || {}), A21_POPUP: { tabId, frameId: Number.isInteger(sender?.frameId) ? sender.frameId : 0 } };
      await saveActive(active);
    }

    setTimeout(() => void runWatcherV060(active, sender, evidence), 0);
    return { ok: true, definitiveWatcher: "HF19", ackBeforeClose: true, version: VERSION_V060 };
  };
})();
