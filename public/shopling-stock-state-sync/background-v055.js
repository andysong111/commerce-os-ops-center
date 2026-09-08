importScripts("background-v054.js");

// HF10: port the price-adjustment extension's definitive completion/close pattern.
// HF8 A21 selection/send and HF9 fallback observer remain untouched. This layer actively
// watches the tracked A21 popup/result target with Chrome debugger Runtime + Accessibility,
// requires the exact option-completion footer to stay stable with no processing state,
// advances the stock job, then closes the managed popup/result window (or only its tab when
// it shares a window with protected worker tabs).
(() => {
  const VERSION_V055 = chrome.runtime.getManifest().version;
  const DEBUGGER_VERSION_V055 = "1.3";
  const STABLE_MS_V055 = 2_500;
  const POLL_MS_V055 = 500;
  const WAIT_LIMIT_MS_V055 = 180_000;
  const watcherKeysV055 = new Set();
  const attachedTabsV055 = new Set();
  const contextsByTabV055 = new Map();
  const legacyHandleEvidenceV055 = handleEvidence;

  const optionFooterRegexV055 = /상품\s*옵션\s*수정\s*전송이\s*완료되었습니다|상품\s*옵션\s*수정\s*전송\s*완료/i;
  const processingRegexV055 = /처리중입니다|잠시만\s*기다려주시기\s*바랍니다/i;

  chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = source?.tabId;
    if (!Number.isInteger(tabId) || !attachedTabsV055.has(tabId)) return;
    if (method === "Runtime.executionContextCreated") {
      const contextId = params?.context?.id;
      if (!Number.isInteger(contextId)) return;
      if (!contextsByTabV055.has(tabId)) contextsByTabV055.set(tabId, new Set());
      contextsByTabV055.get(tabId).add(contextId);
    }
    if (method === "Runtime.executionContextsCleared") contextsByTabV055.set(tabId, new Set());
  });

  chrome.debugger.onDetach.addListener((source) => {
    const tabId = source?.tabId;
    if (!Number.isInteger(tabId)) return;
    attachedTabsV055.delete(tabId);
    contextsByTabV055.delete(tabId);
  });

  async function attachV055(tabId) {
    if (!Number.isInteger(tabId) || tabId < 0) return false;
    if (attachedTabsV055.has(tabId)) return true;
    try {
      await chrome.debugger.attach({ tabId }, DEBUGGER_VERSION_V055);
      attachedTabsV055.add(tabId);
      contextsByTabV055.set(tabId, new Set());
      await chrome.debugger.sendCommand({ tabId }, "Runtime.enable").catch(() => null);
      await chrome.debugger.sendCommand({ tabId }, "Page.enable").catch(() => null);
      await chrome.debugger.sendCommand({ tabId }, "Accessibility.enable").catch(() => null);
      await sleep(140);
      return true;
    } catch {
      return false;
    }
  }

  async function detachV055(tabId) {
    if (!Number.isInteger(tabId) || !attachedTabsV055.has(tabId)) return;
    await chrome.debugger.detach({ tabId }).catch(() => null);
    attachedTabsV055.delete(tabId);
    contextsByTabV055.delete(tabId);
  }

  const FRAME_EXPRESSION_V055 = `(() => {
    try {
      const norm = (v) => String(v ?? '').normalize('NFKC').replace(/\\s+/g, ' ').trim();
      try { window.scrollTo(0, Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0)); } catch {}
      try {
        for (const el of document.querySelectorAll('*')) {
          if (el && el.scrollHeight > el.clientHeight + 16) el.scrollTop = el.scrollHeight;
        }
      } catch {}
      const text = norm(document.body?.innerText || document.body?.textContent || document.documentElement?.innerText || '');
      return {
        ok: true,
        processing: /처리중입니다/i.test(text) || /잠시만\\s*기다려주시기\\s*바랍니다/i.test(text),
        optionFooter: /상품\\s*옵션\\s*수정\\s*전송이\\s*완료되었습니다/i.test(text) || /상품\\s*옵션\\s*수정\\s*전송\\s*완료/i.test(text),
        resultHeading: /쇼핑몰\\s*상품\\s*옵션\\s*수정\\s*전송\\s*결과/i.test(text) || /상품\\s*옵션\\s*수정\\s*전송\\s*결과/i.test(text),
        readyState: String(document.readyState || ''),
        href: String(location.href || ''),
        title: String(document.title || ''),
      };
    } catch (error) {
      return { ok: false, error: String(error?.message || error || 'evaluate failed') };
    }
  })()`;

  async function evaluateOneV055(tabId, contextId, top = false) {
    try {
      const response = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
        expression: FRAME_EXPRESSION_V055,
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

  async function evaluateAllV055(tabId) {
    const rows = [];
    const top = await evaluateOneV055(tabId, null, true);
    if (top) rows.push(top);
    for (const contextId of [...(contextsByTabV055.get(tabId) || [])]) {
      const row = await evaluateOneV055(tabId, contextId, false);
      if (row) rows.push(row);
    }
    return rows.filter((row) => row?.ok);
  }

  async function accessibilityTextV055(tabId) {
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

  function trackedPopupTabIdV055(active) {
    const candidate = active?.workTabs?.A21_POPUP?.tabId;
    if (Number.isInteger(candidate)) return candidate;
    if (Number.isInteger(active?.shoplingTabId)) return active.shoplingTabId;
    return null;
  }

  async function inspectDefinitiveV055(tabId) {
    const attached = await attachV055(tabId);
    if (!attached) return { ok: false, code: "RESULT_DEBUGGER_ATTACH_WAIT", tabId };
    const contexts = await evaluateAllV055(tabId);
    const axText = await accessibilityTextV055(tabId);
    const processing = contexts.some((row) => row.processing) || processingRegexV055.test(axText);
    const expectedInRuntime = contexts.some((row) => row.optionFooter);
    const expectedInAx = optionFooterRegexV055.test(axText);
    const expectedFooter = expectedInRuntime || expectedInAx;
    const matchingContextReady = contexts.some((row) => row.optionFooter && row.readyState === "complete");
    const topReady = contexts.some((row) => row.top && row.readyState === "complete");
    const documentComplete = matchingContextReady || (expectedInAx && topReady);
    const resultHeading = contexts.some((row) => row.resultHeading) || /상품\s*옵션\s*수정\s*전송\s*결과/i.test(axText);
    return {
      ok: true,
      tabId,
      processing,
      expectedFooter,
      expectedInRuntime,
      expectedInAx,
      documentComplete,
      resultHeading,
      contextCount: contexts.length,
    };
  }

  async function protectedWindowIdsV055(active) {
    const ids = new Set();
    for (const [stage, value] of Object.entries(active?.workTabs || {})) {
      if (stage === "A21_POPUP" || !Number.isInteger(value?.tabId)) continue;
      const tab = await chrome.tabs.get(value.tabId).catch(() => null);
      if (Number.isInteger(tab?.windowId)) ids.add(tab.windowId);
    }
    return ids;
  }

  async function closeManagedPopupV055(tabId, active) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return { closed: true, mode: "already-gone" };
    const protectedWindowIds = await protectedWindowIdsV055(active);
    const tabsInWindow = await chrome.tabs.query({ windowId: tab.windowId }).catch(() => []);
    if (Number.isInteger(tab.windowId) && tabsInWindow.length === 1 && !protectedWindowIds.has(tab.windowId)) {
      await chrome.windows.remove(tab.windowId).catch(() => null);
      return { closed: true, mode: "window", windowId: tab.windowId, tabId };
    }
    await chrome.tabs.remove(tabId).catch(() => null);
    return { closed: true, mode: "tab", windowId: tab.windowId, tabId };
  }

  async function runDefinitiveWatcherV055(trigger) {
    const initial = await loadActive();
    if (!initial || initial.status !== "RUNNING" || initial.job?.productKind !== "OPTION" || initial.stage !== "WAIT_A21_RESULT") return false;
    const goodsKey = currentGoodsKey(initial);
    const tabId = trackedPopupTabIdV055(initial);
    if (!Number.isInteger(tabId)) return false;
    const watcherKey = `${initial.job.jobId}:${goodsKey || "none"}:${tabId}`;
    if (watcherKeysV055.has(watcherKey)) return true;
    watcherKeysV055.add(watcherKey);

    const startedAt = Date.now();
    let stableSince = 0;
    let lastProbe = null;
    try {
      await progress(initial, `A21 goods key ${goodsKey} · 가격조정 확장과 동일한 CDP+Accessibility 완료감지 시작`, {
        completionWatcher: "PRICE_V044_CDP_AX_AUTOCLOSE_HF10",
        resultTabId: tabId,
        trigger,
        stableTargetMs: STABLE_MS_V055,
      });

      while (Date.now() - startedAt < WAIT_LIMIT_MS_V055) {
        const active = await loadActive();
        if (!active || active.status !== "RUNNING" || active.job?.jobId !== initial.job?.jobId || active.stage !== "WAIT_A21_RESULT" || currentGoodsKey(active) !== goodsKey) return false;

        const probe = await inspectDefinitiveV055(tabId);
        lastProbe = probe;
        if (!probe.ok || probe.processing || !probe.expectedFooter || !probe.documentComplete) {
          stableSince = 0;
          await sleep(POLL_MS_V055);
          continue;
        }

        if (!stableSince) stableSince = Date.now();
        const stableMs = Date.now() - stableSince;
        if (stableMs < STABLE_MS_V055) {
          await sleep(POLL_MS_V055);
          continue;
        }

        const latest = await loadActive();
        if (!latest || latest.status !== "RUNNING" || latest.stage !== "WAIT_A21_RESULT" || currentGoodsKey(latest) !== goodsKey) return false;
        await progress(latest, `A21 goods key ${goodsKey} · Shopling 최종 완료 footer ${stableMs}ms 안정화 확정 → 성공판정 및 송신창 자동닫기`, {
          completionWatcher: "PRICE_V044_CDP_AX_AUTOCLOSE_HF10",
          resultTabId: tabId,
          stableMs,
          definitiveProbe: probe,
          autoClosePlanned: true,
        });

        const evidence = {
          processing: false,
          optionComplete: true,
          productComplete: false,
          explicitFailure: false,
          successCount: 0,
          failureCount: 0,
          readyState: "complete",
          stableCompletionVerified: true,
          stableCompletionMs: stableMs,
          completionWatcher: "PRICE_V044_CDP_AX_AUTOCLOSE_HF10",
          definitiveProbe: probe,
        };
        const sender = { tab: { id: tabId }, frameId: 0 };
        const advanced = await continueNextGoodsKey(latest, sender, evidence);
        await detachV055(tabId);
        const closeResult = await closeManagedPopupV055(tabId, latest);
        return { ok: true, advanced, closeResult };
      }

      const active = await loadActive();
      if (active && active.status === "RUNNING" && active.stage === "WAIT_A21_RESULT" && currentGoodsKey(active) === goodsKey) {
        await progress(active, `A21 goods key ${goodsKey} · 가격조정식 최종 완료감지 시간초과 · 기존 watchdog으로 이관`, {
          code: "HF10_DEFINITIVE_COMPLETION_TIMEOUT",
          lastProbe,
          resultTabId: tabId,
        });
      }
      return false;
    } finally {
      await detachV055(tabId);
      watcherKeysV055.delete(watcherKey);
    }
  }

  handleEvidence = async function handleEvidenceV055(message, sender) {
    const active = await loadActive();
    if (active?.status === "RUNNING" && active.job?.productKind === "OPTION" && active.stage === "WAIT_A21_RESULT") {
      const evidence = message?.evidence || {};
      if (evidence.optionComplete || evidence.processing) {
        setTimeout(() => void runDefinitiveWatcherV055("resultEvidence"), 0);
        return { ok: true, definitiveWatcher: true };
      }
    }
    return legacyHandleEvidenceV055(message, sender);
  };

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "STOCK_PRICE_CORE_STAGE_V050" && String(message?.stage || "") === "RESULT_WAIT") {
      setTimeout(() => void runDefinitiveWatcherV055("priceCoreResultWait"), 220);
    }
  });

  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.status !== "complete") return;
    setTimeout(() => void runDefinitiveWatcherV055("tabUpdatedComplete"), 120);
  });
})();
