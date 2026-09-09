importScripts("background-v059.js");

// HF24: make SINGLE completion independent of result-page content-script delivery.
// We observed the real terminal document at:
//   aapi10.shopling.co.kr:4315/prod_a/prod_status_trsmt.phtml
//
// HF23 granted that host, but still depended on a content script in that cross-host page
// sending a message back. HF24 removes that dependency completely. The background service
// worker itself watches exact Shopling result tabs, injects a read-only probe with
// chrome.scripting.executeScript, confirms the terminal footer, ACKs the job, then copies
// the price extension's completeJob -> closeManaged ordering and removes the actual result
// and remembered popup windows. HF20-HF23 SINGLE result watchers are not imported.
(() => {
  const VERSION_V065 = chrome.runtime.getManifest().version;
  const POLL_MS_V065 = 300;
  const STABLE_MS_V065 = 2_500;
  const WAIT_LIMIT_MS_V065 = 95_000;
  const SINGLE_STAGE_MESSAGE_V065 = "STOCK_SINGLE_POPUP_STAGE_V011";
  const WORKSPACE_KEY_V065 = "commerceStockWorkspaceV030";
  const watcherKeysV065 = new Set();
  const createdTabsV065 = new Map();

  const sleepV065 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function exactResultUrlV065(raw) {
    try {
      const url = new URL(String(raw || ""));
      const hostOk = url.hostname === "shopling.co.kr" || url.hostname.endsWith(".shopling.co.kr");
      return hostOk && /\/prod_a\/prod_status_trsmt\.phtml$/i.test(url.pathname);
    } catch {
      return false;
    }
  }

  function eligibleSingleV065(active) {
    return Boolean(
      active &&
      active.status === "RUNNING" &&
      active.job?.productKind === "SINGLE" &&
      ["A21_LIST", "A21_POPUP", "WAIT_A21_RESULT"].includes(String(active.stage || ""))
    );
  }

  function watcherKeyV065(active) {
    return `${String(active?.job?.jobId || "none")}:${Number(active?.goodsKeyIndex || 0)}`;
  }

  function recordTabV065(tab, urlOverride = null) {
    if (!Number.isInteger(tab?.id)) return;
    const prior = createdTabsV065.get(tab.id) || null;
    createdTabsV065.set(tab.id, {
      tabId: tab.id,
      windowId: Number.isInteger(tab.windowId) ? tab.windowId : prior?.windowId ?? null,
      openerTabId: Number.isInteger(tab.openerTabId) ? tab.openerTabId : prior?.openerTabId ?? null,
      createdAt: prior?.createdAt || Date.now(),
      updatedAt: Date.now(),
      url: String(urlOverride || tab.pendingUrl || tab.url || prior?.url || ""),
    });
  }

  chrome.tabs.onCreated.addListener((tab) => {
    recordTabV065(tab);
    if (Number.isInteger(tab?.id)) setTimeout(() => void runBackgroundResultWatcherV065("tabCreated", tab.id), 80);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    recordTabV065({ ...tab, id: tabId }, changeInfo.url || null);
    const url = String(changeInfo.url || tab?.url || tab?.pendingUrl || "");
    if (exactResultUrlV065(url) || changeInfo.status === "complete") {
      setTimeout(() => void runBackgroundResultWatcherV065("tabUpdated", tabId), 60);
    }
  });

  if (chrome.webNavigation?.onCommitted) {
    chrome.webNavigation.onCommitted.addListener((details) => {
      if (!Number.isInteger(details?.tabId) || !exactResultUrlV065(details?.url)) return;
      setTimeout(() => void runBackgroundResultWatcherV065("webNavigationCommitted", details.tabId), 40);
    });
  }
  if (chrome.webNavigation?.onCompleted) {
    chrome.webNavigation.onCompleted.addListener((details) => {
      if (!Number.isInteger(details?.tabId) || !exactResultUrlV065(details?.url)) return;
      setTimeout(() => void runBackgroundResultWatcherV065("webNavigationCompleted", details.tabId), 40);
    });
  }

  async function probeResultTabV065(tabId) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return { ok: false, tabId, code: "HF24_TAB_GONE" };
    const url = String(tab.url || tab.pendingUrl || "");
    if (!exactResultUrlV065(url)) return { ok: false, tabId, windowId: tab.windowId, url, code: "HF24_NOT_EXACT_RESULT_URL" };

    const rows = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
        const text = norm(document.body?.innerText || document.body?.textContent || document.documentElement?.innerText || "");
        const totals = [...text.matchAll(/총건수\s*[:：]?\s*([\d,]+)/gi)].map((m) => Number(m[1].replace(/,/g, "")));
        const successes = [...text.matchAll(/성공건수\s*[:：]?\s*([\d,]+)/gi)].map((m) => Number(m[1].replace(/,/g, "")));
        const failures = [...text.matchAll(/실패건수\s*[:：]?\s*([\d,]+)/gi)].map((m) => Number(m[1].replace(/,/g, "")));
        const totalCount = totals.reduce((sum, value) => sum + value, 0);
        const successCount = successes.reduce((sum, value) => sum + value, 0);
        const failureCount = failures.reduce((sum, value) => sum + value, 0);
        return {
          exactFooter: /상품\s*상태\s*변경\s*전송이\s*완료되었습니다/i.test(text),
          fallbackFooter:
            /상품판매상태\s*송신이\s*완료되었습니다/i.test(text) ||
            /상품\s*수정\s*전송이\s*완료되었습니다/i.test(text),
          processing: /처리중입니다/i.test(text) || /잠시만\s*기다려주시기\s*바랍니다/i.test(text),
          countsBalanced: totals.length > 0 && totalCount === successCount + failureCount,
          totalCount,
          successCount,
          failureCount,
          readyState: String(document.readyState || ""),
          href: String(location.href || ""),
          title: String(document.title || ""),
          textTail: text.slice(-1000),
        };
      },
    }).catch(() => []);

    const values = rows.map((row) => row?.result).filter(Boolean);
    const terminalFrame = values.find((row) =>
      !row.processing &&
      row.readyState === "complete" &&
      (row.exactFooter || row.fallbackFooter)
    ) || null;

    return {
      ok: values.length > 0,
      tabId,
      windowId: tab.windowId,
      openerTabId: tab.openerTabId,
      url,
      terminalFrame,
      frameCount: values.length,
      exactFooterFrames: values.filter((row) => row.exactFooter).length,
      processingFrames: values.filter((row) => row.processing).length,
    };
  }

  async function candidateTabsV065(active, hintTabId = null) {
    const tabs = await chrome.tabs.query({}).catch(() => []);
    const stageAt = Number(active?.stageStartedAt || active?.startedAt || Date.now());
    const popupTabId = Number.isInteger(active?.singlePopupTabId) ? active.singlePopupTabId : null;
    const popupWindowId = Number.isInteger(active?.singlePopupWindowId) ? active.singlePopupWindowId : null;
    const out = [];

    for (const tab of tabs) {
      if (!Number.isInteger(tab?.id)) continue;
      const url = String(tab.url || tab.pendingUrl || "");
      if (!exactResultUrlV065(url)) continue;
      const tracked = createdTabsV065.get(tab.id) || null;
      const related =
        tab.id === hintTabId ||
        tab.id === popupTabId ||
        (popupWindowId !== null && tab.windowId === popupWindowId) ||
        (popupTabId !== null && tab.openerTabId === popupTabId) ||
        (tracked && tracked.createdAt >= stageAt - 10_000);
      if (!related) continue;
      out.push(tab);
    }

    const score = (tab) => {
      let value = 0;
      if (tab.id === hintTabId) value += 1000;
      if (tab.id === popupTabId) value += 900;
      if (popupWindowId !== null && tab.windowId === popupWindowId) value += 800;
      if (popupTabId !== null && tab.openerTabId === popupTabId) value += 700;
      const tracked = createdTabsV065.get(tab.id);
      if (tracked && tracked.createdAt >= stageAt - 10_000) value += 300;
      return value;
    };
    out.sort((a, b) => score(b) - score(a));
    return out.slice(0, 8);
  }

  async function removeWindowVerifiedV065(windowId) {
    if (!Number.isInteger(windowId)) return { closed: false, mode: "NO_WINDOW" };
    const before = await chrome.windows.get(windowId).catch(() => null);
    if (!before) return { closed: true, mode: "ALREADY_GONE", windowId };
    await chrome.windows.remove(windowId).catch(() => null);
    const after = await chrome.windows.get(windowId).catch(() => null);
    return { closed: !after, mode: !after ? "WINDOW" : "WINDOW_REMOVE_FAILED", windowId };
  }

  async function closeManagedPriceStyleV065(resultTabId, resultWindowId, popupTabId, popupWindowId) {
    const results = [];
    const windowIds = [...new Set([resultWindowId, popupWindowId].filter(Number.isInteger))];
    for (const windowId of windowIds) results.push(await removeWindowVerifiedV065(windowId));

    for (const tabId of [...new Set([resultTabId, popupTabId].filter(Number.isInteger))]) {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) continue;
      if (windowIds.includes(tab.windowId) && results.some((row) => row.windowId === tab.windowId && row.closed)) continue;
      await chrome.tabs.remove(tabId).catch(() => null);
      results.push({ closed: !(await chrome.tabs.get(tabId).catch(() => null)), mode: "TAB_FALLBACK", tabId, windowId: tab.windowId });
    }
    return results;
  }

  async function closeOwnedWorkersIfFinishedV065(jobId, excludedWindowIds = []) {
    const remaining = await loadActive();
    if (remaining?.status === "RUNNING" && remaining.job?.jobId === jobId) return [];
    const stored = await chrome.storage.local.get(WORKSPACE_KEY_V065).catch(() => ({}));
    const ws = stored?.[WORKSPACE_KEY_V065] || null;
    if (!ws) return [];
    const excluded = new Set(excludedWindowIds.filter(Number.isInteger));
    const ids = new Set();
    for (const target of Object.values(ws.targets || {})) {
      if (!target || target.owned === false) continue;
      if (Number.isInteger(target.windowId) && !excluded.has(target.windowId)) ids.add(target.windowId);
      else if (Number.isInteger(target.tabId)) {
        const tab = await chrome.tabs.get(target.tabId).catch(() => null);
        if (Number.isInteger(tab?.windowId) && !excluded.has(tab.windowId)) ids.add(tab.windowId);
      }
    }
    const closed = [];
    for (const windowId of ids) {
      const result = await removeWindowVerifiedV065(windowId);
      if (result.closed) closed.push(windowId);
    }
    return closed;
  }

  async function finalizeTerminalV065(active, probe, stableMs) {
    const latest = await loadActive();
    if (!eligibleSingleV065(latest) || latest.job?.jobId !== active.job?.jobId || Number(latest.goodsKeyIndex || 0) !== Number(active.goodsKeyIndex || 0)) {
      return false;
    }

    const originalPopupTabId = Number.isInteger(latest.singlePopupTabId) ? latest.singlePopupTabId : null;
    const originalPopupWindowId = Number.isInteger(latest.singlePopupWindowId) ? latest.singlePopupWindowId : null;
    const resultTab = await chrome.tabs.get(probe.tabId).catch(() => null);
    if (!resultTab) return false;

    // The exact terminal document itself is objective proof that submit already happened.
    // Promote a missed A21_POPUP stage to WAIT instead of waiting for a page message that may never arrive.
    if (latest.stage !== "WAIT_A21_RESULT") {
      latest.stage = "WAIT_A21_RESULT";
      latest.stageStartedAt = Date.now();
    }
    latest.singlePopupTabId = probe.tabId;
    latest.singlePopupWindowId = resultTab.windowId ?? null;
    latest.workTabs = {
      ...(latest.workTabs || {}),
      A21_POPUP: { tabId: probe.tabId, frameId: 0 },
    };
    await saveActive(latest);

    const frame = probe.terminalFrame || {};
    const completionEvidence = {
      processing: false,
      productComplete: true,
      readyState: "complete",
      stableCompletionVerified: true,
      stableCompletionMs: stableMs,
      shoplingBatchComplete: true,
      exactProductStateFooterVerified: Boolean(frame.exactFooter),
      exactProductStateFooterText: frame.exactFooter
        ? "상품상태 변경 전송이 완료되었습니다."
        : "판매상태/상품수정 완료 footer",
      countsBalanced: Boolean(frame.countsBalanced),
      successCount: Number(frame.successCount || 0),
      failureCount: Number(frame.failureCount || 0),
      marketFailureCount: Number(frame.failureCount || 0),
      marketFailuresAdvisory: Number(frame.failureCount || 0) > 0,
      explicitFailure: false,
      completionWatcher: "HF24_BACKGROUND_EXACT_AAPI_SCANNER_CLOSEMANAGED",
      resultUrl: probe.url,
    };

    await progress(latest, `A21 단품 · background가 실제 aapi 결과문서를 직접 읽어 완료 확정 → 가격조정 closeManaged 순서로 ACK 후 창 종료`, {
      completionWatcher: completionEvidence.completionWatcher,
      resultTabId: probe.tabId,
      resultWindowId: resultTab.windowId,
      originalPopupTabId,
      originalPopupWindowId,
      resultUrl: probe.url,
      stableMs,
      successCount: completionEvidence.successCount,
      failureCount: completionEvidence.failureCount,
      ackBeforeClose: true,
    });

    const jobId = latest.job.jobId;
    const advanced = await continueNextGoodsKey(
      latest,
      { tab: { id: probe.tabId, windowId: resultTab.windowId }, frameId: 0 },
      completionEvidence,
    );

    // Exact price-extension order: complete/advance state first, then remove managed windows.
    const closeResults = await closeManagedPriceStyleV065(
      probe.tabId,
      resultTab.windowId,
      originalPopupTabId,
      originalPopupWindowId,
    );
    const excluded = [resultTab.windowId, originalPopupWindowId].filter(Number.isInteger);
    const closedWorkerWindows = await closeOwnedWorkersIfFinishedV065(jobId, excluded);

    return { ok: true, advanced, closeResults, closedWorkerWindows };
  }

  async function runBackgroundResultWatcherV065(trigger, hintTabId = null) {
    const initial = await loadActive();
    if (!eligibleSingleV065(initial)) return false;
    const key = watcherKeyV065(initial);
    if (watcherKeysV065.has(key)) return true;
    watcherKeysV065.add(key);

    const startedAt = Date.now();
    let stableTabId = null;
    let stableSince = 0;
    let pollCount = 0;
    let lastDiagnostics = [];
    try {
      await progress(initial, `A21 단품 · HF24 background 직접 결과탭 스캐너 시작`, {
        completionWatcher: "HF24_BACKGROUND_EXACT_AAPI_SCANNER_CLOSEMANAGED",
        trigger,
        hintTabId,
        expectedPath: "/prod_a/prod_status_trsmt.phtml",
        stableTargetMs: STABLE_MS_V065,
      });

      while (Date.now() - startedAt < WAIT_LIMIT_MS_V065) {
        const active = await loadActive();
        if (!eligibleSingleV065(active) || active.job?.jobId !== initial.job?.jobId || Number(active.goodsKeyIndex || 0) !== Number(initial.goodsKeyIndex || 0)) return false;

        const candidates = await candidateTabsV065(active, hintTabId);
        let terminal = null;
        const diagnostics = [];
        for (const tab of candidates) {
          const probe = await probeResultTabV065(tab.id);
          diagnostics.push({
            tabId: tab.id,
            windowId: tab.windowId,
            openerTabId: tab.openerTabId,
            url: String(tab.url || ""),
            ok: probe.ok,
            exactFooterFrames: probe.exactFooterFrames || 0,
            processingFrames: probe.processingFrames || 0,
            frameCount: probe.frameCount || 0,
            code: probe.code || null,
          });
          if (probe.ok && probe.terminalFrame) {
            terminal = probe;
            break;
          }
        }
        lastDiagnostics = diagnostics;
        pollCount += 1;

        if (!terminal) {
          stableTabId = null;
          stableSince = 0;
          if (pollCount % 10 === 0) {
            await progress(active, `A21 단품 · 실제 aapi 결과탭 직접 탐색 중`, {
              completionWatcher: "HF24_BACKGROUND_EXACT_AAPI_SCANNER_CLOSEMANAGED",
              candidateCount: candidates.length,
              diagnostics,
            });
          }
          await sleepV065(POLL_MS_V065);
          continue;
        }

        if (stableTabId !== terminal.tabId) {
          stableTabId = terminal.tabId;
          stableSince = Date.now();
        }
        const stableMs = Date.now() - stableSince;
        if (stableMs < STABLE_MS_V065) {
          await sleepV065(POLL_MS_V065);
          continue;
        }
        return finalizeTerminalV065(initial, terminal, stableMs);
      }

      const latest = await loadActive();
      if (eligibleSingleV065(latest) && latest.job?.jobId === initial.job?.jobId) {
        await progress(latest, `A21 단품 · HF24 background 직접 결과탭 탐색 시간초과`, {
          code: "HF24_BACKGROUND_RESULT_TIMEOUT",
          completionWatcher: "HF24_BACKGROUND_EXACT_AAPI_SCANNER_CLOSEMANAGED",
          lastDiagnostics,
        });
      }
      return false;
    } finally {
      watcherKeysV065.delete(key);
    }
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === SINGLE_STAGE_MESSAGE_V065) {
      const stage = String(message?.stage || "");
      if (["SUBMIT_CLICKING", "RESULT_WAIT"].includes(stage)) {
        const hintTabId = Number.isInteger(sender?.tab?.id) ? sender.tab.id : null;
        setTimeout(() => void runBackgroundResultWatcherV065(`singleStage:${stage}`, hintTabId), 60);
      }
    }
  });
})();
