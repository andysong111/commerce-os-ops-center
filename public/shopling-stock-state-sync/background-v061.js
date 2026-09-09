importScripts("background-v060.js");

// HF20: reuse the live-proven HF10 price-extension completion pattern for SINGLE sale-status results.
// HF19 still depended on a content-script terminal hint before its watcher started. Some Shopling
// sale-status result windows render the final counts successfully but never deliver that hint, so the
// visible result stays open and the base watchdog later reports a false 90-second failure.
//
// This layer starts proactively as soon as SINGLE enters RESULT_WAIT and on Shopling tab navigation.
// It scans only Shopling tabs, reads the result through chrome.scripting + CDP Runtime + Accessibility,
// requires terminal total/success/failure counts (or the legacy completion footer) to remain stable,
// ACKs Commerce OS first, then closes the managed result window exactly like the proven HF10 path.
(() => {
  const VERSION_V061 = chrome.runtime.getManifest().version;
  const DEBUGGER_VERSION_V061 = "1.3";
  const STABLE_MS_V061 = 2_500;
  const POLL_MS_V061 = 450;
  const WAIT_LIMIT_MS_V061 = 88_000;
  const SINGLE_STAGE_V061 = "STOCK_SINGLE_POPUP_STAGE_V011";
  const watcherKeysV061 = new Set();
  const attachedTabsV061 = new Set();
  const contextsByTabV061 = new Map();
  const legacyHandleEvidenceV061 = handleEvidence;

  const processingRegexV061 = /처리중입니다|잠시만\s*기다려주시기\s*바랍니다/i;
  const productFooterRegexV061 = /상품\s*수정\s*전송이\s*완료되었습니다|상품판매상태\s*송신이\s*완료되었습니다/i;
  const resultHeadingRegexV061 = /상품\s*상태\s*변경\s*전송|상품판매상태|쇼핑몰\s*상품.*(?:전송|송신).*결과/i;

  function isSingleResultWaitV061(active) {
    return Boolean(
      active &&
      active.status === "RUNNING" &&
      active.job?.productKind === "SINGLE" &&
      active.stage === "WAIT_A21_RESULT"
    );
  }

  function parseCountsTextV061(text) {
    const normText = String(text || "").normalize("NFKC").replace(/\s+/g, " ").trim();
    const totals = [...normText.matchAll(/총건수\s*[:：]?\s*([\d,]+)/gi)].map((match) => Number(match[1].replace(/,/g, "")));
    const successes = [...normText.matchAll(/성공건수\s*[:：]?\s*([\d,]+)/gi)].map((match) => Number(match[1].replace(/,/g, "")));
    const failures = [...normText.matchAll(/실패건수\s*[:：]?\s*([\d,]+)/gi)].map((match) => Number(match[1].replace(/,/g, "")));
    const totalSum = totals.reduce((sum, value) => sum + value, 0);
    const successSum = successes.reduce((sum, value) => sum + value, 0);
    const failureSum = failures.reduce((sum, value) => sum + value, 0);
    const terminalCounts =
      totals.length > 0 &&
      totals.length === successes.length &&
      totals.length === failures.length &&
      totalSum === successSum + failureSum;
    return {
      terminalCounts,
      totalBlocks: totals.length,
      successBlocks: successes.length,
      failureBlocks: failures.length,
      totalSum,
      successSum,
      failureSum,
    };
  }

  chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = source?.tabId;
    if (!Number.isInteger(tabId) || !attachedTabsV061.has(tabId)) return;
    if (method === "Runtime.executionContextCreated") {
      const contextId = params?.context?.id;
      if (!Number.isInteger(contextId)) return;
      if (!contextsByTabV061.has(tabId)) contextsByTabV061.set(tabId, new Set());
      contextsByTabV061.get(tabId).add(contextId);
    }
    if (method === "Runtime.executionContextsCleared") contextsByTabV061.set(tabId, new Set());
  });

  chrome.debugger.onDetach.addListener((source) => {
    const tabId = source?.tabId;
    if (!Number.isInteger(tabId)) return;
    attachedTabsV061.delete(tabId);
    contextsByTabV061.delete(tabId);
  });

  async function attachV061(tabId) {
    if (!Number.isInteger(tabId) || tabId < 0) return false;
    if (attachedTabsV061.has(tabId)) return true;
    try {
      await chrome.debugger.attach({ tabId }, DEBUGGER_VERSION_V061);
      attachedTabsV061.add(tabId);
      contextsByTabV061.set(tabId, new Set());
      await chrome.debugger.sendCommand({ tabId }, "Runtime.enable").catch(() => null);
      await chrome.debugger.sendCommand({ tabId }, "Page.enable").catch(() => null);
      await chrome.debugger.sendCommand({ tabId }, "Accessibility.enable").catch(() => null);
      await sleep(120);
      return true;
    } catch {
      return false;
    }
  }

  async function detachV061(tabId) {
    if (!Number.isInteger(tabId) || !attachedTabsV061.has(tabId)) return;
    await chrome.debugger.detach({ tabId }).catch(() => null);
    attachedTabsV061.delete(tabId);
    contextsByTabV061.delete(tabId);
  }

  async function detachAllV061() {
    for (const tabId of [...attachedTabsV061]) await detachV061(tabId);
  }

  const FRAME_EXPRESSION_V061 = `(() => {
    try {
      const norm = (v) => String(v ?? '').normalize('NFKC').replace(/\\s+/g, ' ').trim();
      try { window.scrollTo(0, Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0)); } catch {}
      try {
        for (const el of document.querySelectorAll('*')) {
          if (el && el.scrollHeight > el.clientHeight + 16) el.scrollTop = el.scrollHeight;
        }
      } catch {}
      const text = norm(document.body?.innerText || document.body?.textContent || document.documentElement?.innerText || '');
      const totals = [...text.matchAll(/총건수\\s*[:：]?\\s*([\\d,]+)/gi)].map((m) => Number(m[1].replace(/,/g, '')));
      const successes = [...text.matchAll(/성공건수\\s*[:：]?\\s*([\\d,]+)/gi)].map((m) => Number(m[1].replace(/,/g, '')));
      const failures = [...text.matchAll(/실패건수\\s*[:：]?\\s*([\\d,]+)/gi)].map((m) => Number(m[1].replace(/,/g, '')));
      const totalSum = totals.reduce((s, v) => s + v, 0);
      const successSum = successes.reduce((s, v) => s + v, 0);
      const failureSum = failures.reduce((s, v) => s + v, 0);
      const terminalCounts = totals.length > 0 && totals.length === successes.length && totals.length === failures.length && totalSum === successSum + failureSum;
      return {
        ok: true,
        processing: /처리중입니다/i.test(text) || /잠시만\\s*기다려주시기\\s*바랍니다/i.test(text),
        terminalCounts,
        productFooter: /상품\\s*수정\\s*전송이\\s*완료되었습니다/i.test(text) || /상품판매상태\\s*송신이\\s*완료되었습니다/i.test(text),
        resultHeading: /상품\\s*상태\\s*변경\\s*전송|상품판매상태|쇼핑몰\\s*상품.*(?:전송|송신).*결과/i.test(text),
        totalBlocks: totals.length,
        totalSum,
        successSum,
        failureSum,
        readyState: String(document.readyState || ''),
        href: String(location.href || ''),
        title: String(document.title || ''),
      };
    } catch (error) {
      return { ok: false, error: String(error?.message || error || 'evaluate failed') };
    }
  })()`;

  async function evaluateOneV061(tabId, contextId, top = false) {
    try {
      const response = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
        expression: FRAME_EXPRESSION_V061,
        returnByValue: true,
        awaitPromise: false,
        ...(Number.isInteger(contextId) ? { contextId } : {}),
      });
      const value = response?.result?.value;
      return value && typeof value === "object" ? { ...value, top } : null;
    } catch {
      return null;
    }
  }

  async function evaluateAllV061(tabId) {
    const rows = [];
    const top = await evaluateOneV061(tabId, null, true);
    if (top) rows.push(top);
    for (const contextId of [...(contextsByTabV061.get(tabId) || [])]) {
      const row = await evaluateOneV061(tabId, contextId, false);
      if (row) rows.push(row);
    }
    return rows.filter((row) => row?.ok);
  }

  async function accessibilityTextV061(tabId) {
    try {
      const response = await chrome.debugger.sendCommand({ tabId }, "Accessibility.getFullAXTree", {});
      const chunks = [];
      for (const node of response?.nodes || []) {
        for (const value of [node?.name?.value, node?.value?.value, node?.description?.value]) {
          if (value) chunks.push(String(value));
        }
      }
      return chunks.join(" ").normalize("NFKC").replace(/\s+/g, " ").trim();
    } catch {
      return "";
    }
  }

  async function scriptingProbeV061(tabId) {
    const rows = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const norm = (v) => String(v ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
        const text = norm(document.body?.innerText || document.body?.textContent || document.documentElement?.innerText || "");
        const totals = [...text.matchAll(/총건수\s*[:：]?\s*([\d,]+)/gi)].map((m) => Number(m[1].replace(/,/g, "")));
        const successes = [...text.matchAll(/성공건수\s*[:：]?\s*([\d,]+)/gi)].map((m) => Number(m[1].replace(/,/g, "")));
        const failures = [...text.matchAll(/실패건수\s*[:：]?\s*([\d,]+)/gi)].map((m) => Number(m[1].replace(/,/g, "")));
        const totalSum = totals.reduce((s, v) => s + v, 0);
        const successSum = successes.reduce((s, v) => s + v, 0);
        const failureSum = failures.reduce((s, v) => s + v, 0);
        return {
          processing: /처리중입니다/i.test(text) || /잠시만\s*기다려주시기\s*바랍니다/i.test(text),
          terminalCounts: totals.length > 0 && totals.length === successes.length && totals.length === failures.length && totalSum === successSum + failureSum,
          productFooter: /상품\s*수정\s*전송이\s*완료되었습니다/i.test(text) || /상품판매상태\s*송신이\s*완료되었습니다/i.test(text),
          resultHeading: /상품\s*상태\s*변경\s*전송|상품판매상태|쇼핑몰\s*상품.*(?:전송|송신).*결과/i.test(text),
          totalBlocks: totals.length,
          totalSum,
          successSum,
          failureSum,
          readyState: String(document.readyState || ""),
          href: String(location.href || ""),
          title: String(document.title || ""),
        };
      },
    }).catch(() => []);
    return rows.map((row) => row?.result).filter(Boolean);
  }

  async function inspectTabV061(tabId) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return { ok: false, tabId, code: "HF20_TAB_GONE" };

    const scriptRows = await scriptingProbeV061(tabId);
    const attached = await attachV061(tabId);
    const runtimeRows = attached ? await evaluateAllV061(tabId) : [];
    const axText = attached ? await accessibilityTextV061(tabId) : "";
    const axCounts = parseCountsTextV061(axText);

    const allRows = [...scriptRows, ...runtimeRows];
    const processing = allRows.some((row) => row.processing) || processingRegexV061.test(axText);
    const terminalCounts = allRows.some((row) => row.terminalCounts) || axCounts.terminalCounts;
    const productFooter = allRows.some((row) => row.productFooter) || productFooterRegexV061.test(axText);
    const resultHeading = allRows.some((row) => row.resultHeading) || resultHeadingRegexV061.test(axText);
    const terminal = terminalCounts || productFooter;
    const rowReady = allRows.some((row) => (row.terminalCounts || row.productFooter) && row.readyState === "complete");
    const documentComplete = rowReady || (terminal && String(tab.status || "") === "complete");
    const failureCount = Math.max(
      0,
      axCounts.failureSum,
      ...allRows.map((row) => Number(row.failureSum || 0)),
    );
    const successCount = Math.max(
      0,
      axCounts.successSum,
      ...allRows.map((row) => Number(row.successSum || 0)),
    );
    const totalCount = Math.max(
      0,
      axCounts.totalSum,
      ...allRows.map((row) => Number(row.totalSum || 0)),
    );

    return {
      ok: scriptRows.length > 0 || runtimeRows.length > 0 || Boolean(axText),
      tabId,
      windowId: tab.windowId,
      url: String(tab.url || ""),
      processing,
      terminal,
      terminalCounts,
      productFooter,
      resultHeading,
      documentComplete,
      totalCount,
      successCount,
      failureCount,
      runtimeContextCount: runtimeRows.length,
      scriptFrameCount: scriptRows.length,
      accessibilityDetected: Boolean(axText),
      debuggerAttached: attached,
    };
  }

  function isShoplingTabV061(tab) {
    try {
      return new URL(String(tab?.url || "")).origin === "https://a.shopling.co.kr";
    } catch {
      return false;
    }
  }

  async function candidateTabsV061(active, hintTabId = null) {
    const allTabs = await chrome.tabs.query({}).catch(() => []);
    const byId = new Map(allTabs.filter((tab) => Number.isInteger(tab?.id)).map((tab) => [tab.id, tab]));
    const ordered = [];
    const seen = new Set();
    const add = (tabId) => {
      if (!Number.isInteger(tabId) || seen.has(tabId)) return;
      const tab = byId.get(tabId);
      if (!tab || !isShoplingTabV061(tab)) return;
      seen.add(tabId);
      ordered.push(tab);
    };

    add(hintTabId);
    add(active?.singlePopupTabId);
    add(active?.workTabs?.A21_POPUP?.tabId);
    add(active?.shoplingTabId);
    for (const tab of allTabs) if (isShoplingTabV061(tab)) add(tab.id);
    return ordered.slice(0, 12);
  }

  async function protectedTabIdsV061(active) {
    const ids = new Set();
    for (const [stage, value] of Object.entries(active?.workTabs || {})) {
      if (stage === "A21_POPUP" || !Number.isInteger(value?.tabId)) continue;
      ids.add(value.tabId);
    }
    return ids;
  }

  async function protectedWindowIdsV061(active) {
    const ids = new Set();
    for (const tabId of await protectedTabIdsV061(active)) {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (Number.isInteger(tab?.windowId)) ids.add(tab.windowId);
    }
    return ids;
  }

  async function closeManagedResultV061(tabId, active) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return { closed: true, mode: "already-gone" };
    const protectedTabIds = await protectedTabIdsV061(active);
    if (protectedTabIds.has(tabId)) return { closed: false, mode: "protected-work-tab", tabId };
    const protectedWindowIds = await protectedWindowIdsV061(active);
    const tabsInWindow = Number.isInteger(tab.windowId)
      ? await chrome.tabs.query({ windowId: tab.windowId }).catch(() => [])
      : [];
    if (Number.isInteger(tab.windowId) && tabsInWindow.length === 1 && !protectedWindowIds.has(tab.windowId)) {
      await chrome.windows.remove(tab.windowId).catch(() => null);
      return { closed: true, mode: "window", windowId: tab.windowId, tabId };
    }
    await chrome.tabs.remove(tabId).catch(() => null);
    return { closed: true, mode: "tab", windowId: tab.windowId, tabId };
  }

  async function runDefinitiveWatcherV061(trigger, hintTabId = null) {
    const initial = await loadActive();
    if (!isSingleResultWaitV061(initial)) return false;
    const goodsKey = currentGoodsKey(initial);
    const watcherKey = `${initial.job.jobId}:${goodsKey || "none"}`;
    if (watcherKeysV061.has(watcherKey)) return true;
    watcherKeysV061.add(watcherKey);

    const startedAt = Date.now();
    let stableKey = "";
    let stableSince = 0;
    let lastDiagnostics = [];
    try {
      await progress(initial, `A21 단품 goods key ${goodsKey} · HF10과 동일한 CDP+Accessibility 결과감지 시작`, {
        completionWatcher: "HF20_SINGLE_PRICE_V044_STYLE_CDP_AX_AUTOCLOSE",
        trigger,
        stableTargetMs: STABLE_MS_V061,
        contentHintRequired: false,
      });

      while (Date.now() - startedAt < WAIT_LIMIT_MS_V061) {
        const active = await loadActive();
        if (!isSingleResultWaitV061(active) || active.job?.jobId !== initial.job?.jobId || currentGoodsKey(active) !== goodsKey) return false;

        const candidates = await candidateTabsV061(active, hintTabId);
        const diagnostics = [];
        let terminalProbe = null;
        for (const tab of candidates) {
          const probe = await inspectTabV061(tab.id);
          diagnostics.push({
            tabId: probe.tabId,
            windowId: probe.windowId,
            terminal: probe.terminal,
            terminalCounts: probe.terminalCounts,
            productFooter: probe.productFooter,
            resultHeading: probe.resultHeading,
            processing: probe.processing,
            documentComplete: probe.documentComplete,
            totalCount: probe.totalCount,
            successCount: probe.successCount,
            failureCount: probe.failureCount,
            debuggerAttached: probe.debuggerAttached,
          });
          if (probe.ok && !probe.processing && probe.terminal && probe.documentComplete) {
            terminalProbe = probe;
            break;
          }
        }
        lastDiagnostics = diagnostics;

        if (!terminalProbe) {
          stableKey = "";
          stableSince = 0;
          await sleep(POLL_MS_V061);
          continue;
        }

        const nextStableKey = `${terminalProbe.tabId}:${terminalProbe.totalCount}:${terminalProbe.successCount}:${terminalProbe.failureCount}`;
        if (stableKey !== nextStableKey) {
          stableKey = nextStableKey;
          stableSince = Date.now();
        }
        const stableMs = Date.now() - stableSince;
        if (stableMs < STABLE_MS_V061) {
          await sleep(POLL_MS_V061);
          continue;
        }

        const latest = await loadActive();
        if (!isSingleResultWaitV061(latest) || latest.job?.jobId !== initial.job?.jobId || currentGoodsKey(latest) !== goodsKey) return false;
        const resultTab = await chrome.tabs.get(terminalProbe.tabId).catch(() => null);
        if (!resultTab) {
          stableKey = "";
          stableSince = 0;
          await sleep(POLL_MS_V061);
          continue;
        }

        latest.singlePopupTabId = terminalProbe.tabId;
        latest.singlePopupWindowId = resultTab.windowId ?? null;
        latest.workTabs = {
          ...(latest.workTabs || {}),
          A21_POPUP: { tabId: terminalProbe.tabId, frameId: 0 },
        };
        await saveActive(latest);

        const completionEvidence = {
          processing: false,
          productComplete: true,
          optionComplete: false,
          explicitFailure: false,
          successCount: Number(terminalProbe.successCount || 0),
          failureCount: Number(terminalProbe.failureCount || 0),
          readyState: "complete",
          stableCompletionVerified: true,
          stableCompletionMs: stableMs,
          shoplingBatchComplete: true,
          terminalCountsVerified: Boolean(terminalProbe.terminalCounts),
          marketFailureCount: Number(terminalProbe.failureCount || 0),
          marketFailuresAdvisory: Number(terminalProbe.failureCount || 0) > 0,
          completionWatcher: "HF20_SINGLE_PRICE_V044_STYLE_CDP_AX_AUTOCLOSE",
          definitiveProbe: terminalProbe,
          contentHintRequired: false,
          ackBeforeClose: true,
        };

        await progress(latest, `A21 단품 goods key ${goodsKey} · 최종 결과 ${stableMs}ms 안정화 확정 → 성공 ACK → 송신창 자동닫기`, {
          completionWatcher: completionEvidence.completionWatcher,
          resultTabId: terminalProbe.tabId,
          resultWindowId: terminalProbe.windowId,
          totalCount: terminalProbe.totalCount,
          successCount: terminalProbe.successCount,
          marketFailureCount: terminalProbe.failureCount,
          terminalCountsVerified: terminalProbe.terminalCounts,
          ackBeforeClose: true,
          closePattern: "HF10_PRICE_EXTENSION_MANAGED_WINDOW_CLOSE",
        });

        const sender = { tab: { id: terminalProbe.tabId, windowId: terminalProbe.windowId }, frameId: 0 };
        const advanced = await continueNextGoodsKey(latest, sender, completionEvidence);
        await detachV061(terminalProbe.tabId);
        const closeResult = await closeManagedResultV061(terminalProbe.tabId, latest);

        const remaining = await loadActive();
        if (remaining?.status === "RUNNING" && remaining.job?.jobId === initial.job?.jobId) {
          if (remaining.singlePopupTabId === terminalProbe.tabId) remaining.singlePopupTabId = null;
          if (remaining.singlePopupWindowId === terminalProbe.windowId) remaining.singlePopupWindowId = null;
          if (remaining.workTabs?.A21_POPUP?.tabId === terminalProbe.tabId) {
            const nextTabs = { ...(remaining.workTabs || {}) };
            delete nextTabs.A21_POPUP;
            remaining.workTabs = nextTabs;
          }
          await saveActive(remaining);
        }
        return { ok: true, advanced, closeResult, probe: terminalProbe };
      }

      const latest = await loadActive();
      if (isSingleResultWaitV061(latest) && latest.job?.jobId === initial.job?.jobId) {
        await progress(latest, `A21 단품 goods key ${goodsKey} · HF20 CDP+Accessibility 결과감지 시간초과`, {
          code: "HF20_SINGLE_CDP_AX_RESULT_TIMEOUT",
          trigger,
          lastDiagnostics,
        });
      }
      return false;
    } finally {
      await detachAllV061();
      watcherKeysV061.delete(watcherKey);
    }
  }

  // Own SINGLE result evidence in HF20 so HF19's content-hint-gated watcher cannot race us.
  // OPTION and every earlier flow continue through the existing HF19/HF10 chain unchanged.
  handleEvidence = async function handleEvidenceV061(message, sender) {
    const active = await loadActive();
    if (!isSingleResultWaitV061(active)) return legacyHandleEvidenceV061(message, sender);
    const hintTabId = Number.isInteger(sender?.tab?.id) ? sender.tab.id : null;
    setTimeout(() => void runDefinitiveWatcherV061("resultEvidenceFallback", hintTabId), 0);
    return {
      ok: true,
      definitiveWatcher: "HF20_CDP_AX_PROACTIVE",
      contentHintRequired: false,
      ackBeforeClose: true,
      version: VERSION_V061,
    };
  };

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === SINGLE_STAGE_V061 && String(message?.stage || "") === "RESULT_WAIT") {
      const hintTabId = Number.isInteger(sender?.tab?.id) ? sender.tab.id : null;
      setTimeout(() => void runDefinitiveWatcherV061("singleResultWait", hintTabId), 220);
    }
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete" || !isShoplingTabV061(tab)) return;
    setTimeout(() => void runDefinitiveWatcherV061("shoplingTabUpdatedComplete", tabId), 120);
  });

  chrome.tabs.onCreated.addListener((tab) => {
    if (!isShoplingTabV061(tab)) return;
    setTimeout(() => void runDefinitiveWatcherV061("shoplingTabCreated", tab.id), 220);
  });
})();
