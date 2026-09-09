importScripts("background-v062.js");

// HF22: port the ACTUAL live price-adjustment extension v0.4.4 result lifecycle to SINGLE.
// Root cause proven from the price extension source:
// - it does NOT restrict result candidates to https://a.shopling.co.kr tabs;
// - it tracks newly-created tabs and opener relationships, including about:blank/javascript/blob;
// - it polls every execution context + Accessibility tree, scrolling each context to bottom;
// - after the exact final footer is stable it completes the job and removes managed windows.
// HF20/HF21 copied only parts of that behavior and still filtered candidates to Shopling-origin tabs,
// so a real result child window could remain completely invisible to the watcher.
(() => {
  const VERSION_V063 = chrome.runtime.getManifest().version;
  const WORKSPACE_KEY_V063 = "commerceStockWorkspaceV030";
  const DEBUGGER_VERSION_V063 = "1.3";
  const POLL_MS_V063 = 500;
  const STABLE_MS_V063 = 2_500;
  const WAIT_LIMIT_MS_V063 = 90_000;
  const SINGLE_STAGE_V063 = "STOCK_SINGLE_POPUP_STAGE_V011";
  const attachedTabsV063 = new Set();
  const contextsByTabV063 = new Map();
  const createdTabsV063 = [];
  const watchersV063 = new Set();

  const normV063 = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();

  function isSingleWaitV063(active) {
    return Boolean(
      active &&
      active.status === "RUNNING" &&
      active.job?.productKind === "SINGLE" &&
      active.stage === "WAIT_A21_RESULT"
    );
  }

  function recordCreatedV063(tab) {
    if (!Number.isInteger(tab?.id)) return;
    const existing = createdTabsV063.find((row) => row.tabId === tab.id);
    const payload = {
      tabId: tab.id,
      openerTabId: Number.isInteger(tab.openerTabId) ? tab.openerTabId : existing?.openerTabId ?? null,
      windowId: Number.isInteger(tab.windowId) ? tab.windowId : existing?.windowId ?? null,
      createdAt: existing?.createdAt || Date.now(),
      url: String(tab.pendingUrl || tab.url || existing?.url || ""),
      title: String(tab.title || existing?.title || ""),
    };
    if (existing) Object.assign(existing, payload);
    else createdTabsV063.push(payload);
    if (createdTabsV063.length > 200) createdTabsV063.splice(0, createdTabsV063.length - 200);
  }

  chrome.tabs.onCreated.addListener((tab) => {
    recordCreatedV063(tab);
    if (Number.isInteger(tab?.id)) setTimeout(() => void runPriceLifecycleWatcherV063("tabCreated", tab.id), 120);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    recordCreatedV063({ ...tab, id: tabId, pendingUrl: changeInfo.url || tab?.pendingUrl });
    if (changeInfo.status === "complete") setTimeout(() => void runPriceLifecycleWatcherV063("tabUpdatedComplete", tabId), 100);
  });

  chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = source?.tabId;
    if (!Number.isInteger(tabId) || !attachedTabsV063.has(tabId)) return;
    if (method === "Runtime.executionContextCreated") {
      const contextId = params?.context?.id;
      if (!Number.isInteger(contextId)) return;
      if (!contextsByTabV063.has(tabId)) contextsByTabV063.set(tabId, new Set());
      contextsByTabV063.get(tabId).add(contextId);
    }
    if (method === "Runtime.executionContextsCleared") contextsByTabV063.set(tabId, new Set());
  });

  chrome.debugger.onDetach.addListener((source) => {
    const tabId = source?.tabId;
    if (!Number.isInteger(tabId)) return;
    attachedTabsV063.delete(tabId);
    contextsByTabV063.delete(tabId);
  });

  async function attachV063(tabId) {
    if (!Number.isInteger(tabId) || tabId < 0) return false;
    if (attachedTabsV063.has(tabId)) return true;
    try {
      await chrome.debugger.attach({ tabId }, DEBUGGER_VERSION_V063);
      attachedTabsV063.add(tabId);
      contextsByTabV063.set(tabId, new Set());
      await chrome.debugger.sendCommand({ tabId }, "Runtime.enable").catch(() => null);
      await chrome.debugger.sendCommand({ tabId }, "Page.enable").catch(() => null);
      await chrome.debugger.sendCommand({ tabId }, "Accessibility.enable").catch(() => null);
      await sleep(140);
      return true;
    } catch {
      return false;
    }
  }

  async function detachV063(tabId) {
    if (!Number.isInteger(tabId) || !attachedTabsV063.has(tabId)) return;
    await chrome.debugger.detach({ tabId }).catch(() => null);
    attachedTabsV063.delete(tabId);
    contextsByTabV063.delete(tabId);
  }

  async function detachAllV063() {
    for (const tabId of [...attachedTabsV063]) await detachV063(tabId);
  }

  const FRAME_EXPRESSION_V063 = `(() => {
    try {
      const norm = (v) => String(v ?? '').normalize('NFKC').replace(/\\s+/g, ' ').trim();
      try { window.scrollTo(0, Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0)); } catch {}
      try {
        for (const el of document.querySelectorAll('*')) {
          if (el && el.scrollHeight > el.clientHeight + 16) el.scrollTop = el.scrollHeight;
        }
      } catch {}
      const text = norm(document.body?.innerText || document.body?.textContent || document.documentElement?.innerText || '');
      const processing = /처리중입니다/i.test(text) || /잠시만\\s*기다려주시기\\s*바랍니다/i.test(text);
      const stateFooter =
        /상품\\s*상태\\s*변경\\s*전송이\\s*완료되었습니다/i.test(text) ||
        /상품판매상태\\s*송신이\\s*완료되었습니다/i.test(text) ||
        /상품\\s*수정\\s*전송이\\s*완료되었습니다/i.test(text);
      const resultHeading =
        /쇼핑몰\\s*상품\\s*상태\\s*변경\\s*전송\\s*결과/i.test(text) ||
        /상품\\s*상태\\s*변경\\s*전송\\s*결과/i.test(text) ||
        /쇼핑몰\\s*상품.*(?:전송|송신).*결과/i.test(text);
      const successLabels = (text.match(/성공건수\\s*[:：]?\\s*[\\d,]+/gi) || []).length;
      const failureLabels = (text.match(/실패건수\\s*[:：]?\\s*[\\d,]+/gi) || []).length;
      const outcomeRows = /성공여부/i.test(text) && /쇼핑몰상품코드/i.test(text);
      return {
        ok: true,
        processing,
        stateFooter,
        resultHeading,
        successLabels,
        failureLabels,
        outcomeRows,
        readyState: String(document.readyState || ''),
        href: String(location.href || ''),
        title: String(document.title || ''),
        textLength: text.length,
      };
    } catch (error) {
      return { ok: false, error: String(error?.message || error || 'evaluate failed') };
    }
  })()`;

  async function evaluateOneV063(tabId, contextId, top = false) {
    try {
      const response = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
        expression: FRAME_EXPRESSION_V063,
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

  async function evaluateAllV063(tabId) {
    const rows = [];
    const top = await evaluateOneV063(tabId, null, true);
    if (top) rows.push(top);
    for (const contextId of [...(contextsByTabV063.get(tabId) || [])]) {
      const row = await evaluateOneV063(tabId, contextId, false);
      if (row) rows.push(row);
    }
    return rows.filter((row) => row?.ok);
  }

  async function accessibilityTextV063(tabId) {
    try {
      const response = await chrome.debugger.sendCommand({ tabId }, "Accessibility.getFullAXTree", {});
      const chunks = [];
      for (const node of response?.nodes || []) {
        for (const value of [node?.name?.value, node?.value?.value, node?.description?.value]) {
          if (value) chunks.push(String(value));
        }
      }
      return normV063(chunks.join(" "));
    } catch {
      return "";
    }
  }

  function footerRegexV063() {
    return /상품\s*상태\s*변경\s*전송이\s*완료되었습니다|상품판매상태\s*송신이\s*완료되었습니다|상품\s*수정\s*전송이\s*완료되었습니다/i;
  }

  async function workspaceV063() {
    return (await chrome.storage.local.get(WORKSPACE_KEY_V063).catch(() => ({})))[WORKSPACE_KEY_V063] || null;
  }

  async function relatedWorkerTabIdsV063(active) {
    const ids = new Set();
    for (const value of Object.values(active?.workTabs || {})) if (Number.isInteger(value?.tabId)) ids.add(value.tabId);
    if (Number.isInteger(active?.shoplingTabId)) ids.add(active.shoplingTabId);
    const ws = await workspaceV063();
    for (const value of Object.values(ws?.targets || {})) if (Number.isInteger(value?.tabId)) ids.add(value.tabId);
    return ids;
  }

  async function plausibleTabV063(tab, active, hintTabId, since) {
    if (!tab || !Number.isInteger(tab.id)) return false;
    const workerIds = await relatedWorkerTabIdsV063(active);
    const known = [hintTabId, active?.singlePopupTabId, active?.workTabs?.A21_POPUP?.tabId].filter(Number.isInteger);
    if (known.includes(tab.id)) return true;
    if (workerIds.has(tab.openerTabId)) return true;
    if (Number.isInteger(active?.singlePopupTabId) && tab.openerTabId === active.singlePopupTabId) return true;
    const url = String(tab.url || tab.pendingUrl || "");
    const title = String(tab.title || "");
    const created = createdTabsV063.find((row) => row.tabId === tab.id && row.createdAt >= since - 5_000);
    if (created && (workerIds.has(created.openerTabId) || created.openerTabId === active?.singlePopupTabId)) return true;
    if (created && /shopling/i.test(created.url || "")) return true;
    if (/https:\/\/a\.shopling\.co\.kr/i.test(url)) return true;
    if (created && /^(about:blank|javascript:|blob:)/i.test(url)) return true;
    if (/샵플링|shopling/i.test(title) && created) return true;
    return false;
  }

  async function candidateTabsV063(active, hintTabId, since) {
    const tabs = await chrome.tabs.query({}).catch(() => []);
    const candidates = [];
    for (const tab of tabs) if (await plausibleTabV063(tab, active, hintTabId, since)) candidates.push(tab);
    const workerIds = await relatedWorkerTabIdsV063(active);
    const score = (tab) => {
      let value = 0;
      if (tab.id === hintTabId) value += 120;
      if (tab.id === active?.singlePopupTabId) value += 110;
      if (tab.id === active?.workTabs?.A21_POPUP?.tabId) value += 100;
      if (workerIds.has(tab.openerTabId)) value += 80;
      const created = createdTabsV063.find((row) => row.tabId === tab.id);
      if (created && created.createdAt >= since - 5_000) value += 50;
      if (/prodlinkage|shopling/i.test(String(tab.url || ""))) value += 20;
      if (/^(about:blank|javascript:|blob:)/i.test(String(tab.url || ""))) value += 15;
      return value;
    };
    candidates.sort((a, b) => score(b) - score(a));
    return candidates.slice(0, 16);
  }

  async function inspectPriceStyleV063(tabId) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return { ok: false, tabId, code: "HF22_TAB_GONE" };
    const attached = await attachV063(tabId);
    if (!attached) return { ok: false, tabId, windowId: tab.windowId, code: "HF22_ATTACH_WAIT" };
    const contexts = await evaluateAllV063(tabId);
    const axText = await accessibilityTextV063(tabId);
    const expectedRegex = footerRegexV063();
    const processing = contexts.some((row) => row.processing) || /처리중입니다|잠시만\s*기다려주시기\s*바랍니다/i.test(axText);
    const expectedInRuntime = contexts.some((row) => row.stateFooter);
    const expectedInAx = expectedRegex.test(axText);
    const expectedFooter = expectedInRuntime || expectedInAx;
    const topReady = contexts.some((row) => row.top && row.readyState === "complete");
    const matchingContextReady = contexts.some((row) => row.stateFooter && row.readyState === "complete");
    const documentComplete = matchingContextReady || (expectedInAx && topReady);
    const resultHeading = contexts.some((row) => row.resultHeading) || /상품\s*상태\s*변경\s*전송\s*결과|쇼핑몰\s*상품.*(?:전송|송신).*결과/i.test(axText);
    return {
      ok: contexts.length > 0 || Boolean(axText),
      tabId,
      windowId: tab.windowId,
      openerTabId: tab.openerTabId,
      url: String(tab.url || ""),
      processing,
      expectedFooter,
      expectedInRuntime,
      expectedInAx,
      documentComplete,
      resultHeading,
      contextCount: contexts.length,
    };
  }

  async function closeResultWindowV063(tabId) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return { closed: true, mode: "ALREADY_GONE" };
    if (Number.isInteger(tab.windowId)) {
      await chrome.windows.remove(tab.windowId).catch(() => null);
      const gone = !(await chrome.windows.get(tab.windowId).catch(() => null));
      if (gone) return { closed: true, mode: "WINDOW", tabId, windowId: tab.windowId };
    }
    await chrome.tabs.remove(tabId).catch(() => null);
    return { closed: true, mode: "TAB", tabId, windowId: tab.windowId };
  }

  async function closeOwnedWorkspaceWindowsV063(excludeWindowId = null) {
    const ws = await workspaceV063();
    const ids = new Set();
    for (const target of Object.values(ws?.targets || {})) {
      if (target?.owned === false) continue;
      if (Number.isInteger(target?.windowId) && target.windowId !== excludeWindowId) ids.add(target.windowId);
    }
    const closed = [];
    for (const windowId of ids) {
      await chrome.windows.remove(windowId).catch(() => null);
      if (!(await chrome.windows.get(windowId).catch(() => null))) closed.push(windowId);
    }
    return closed;
  }

  async function finalizeAndCloseV063(initial, probe, stableMs) {
    const latest = await loadActive();
    if (!isSingleWaitV063(latest) || latest.job?.jobId !== initial.job?.jobId) return false;
    const resultTab = await chrome.tabs.get(probe.tabId).catch(() => null);
    if (!resultTab) return false;

    latest.singlePopupTabId = probe.tabId;
    latest.singlePopupWindowId = resultTab.windowId ?? null;
    latest.workTabs = { ...(latest.workTabs || {}), A21_POPUP: { tabId: probe.tabId, frameId: 0 } };
    await saveActive(latest);

    const completionEvidence = {
      processing: false,
      productComplete: true,
      readyState: "complete",
      stableCompletionVerified: true,
      stableCompletionMs: stableMs,
      shoplingBatchComplete: true,
      exactProductStateFooterVerified: true,
      completionWatcher: "HF22_PRICE_V044_ACTUAL_RESULT_LIFECYCLE",
      resultCandidatePolicy: "PRICE_V044_CREATED_TAB_OPENER_ABOUT_BLANK_PLUS_CDP_AX",
      explicitFailure: false,
    };

    await progress(latest, `A21 단품 · 가격조정 확장 v0.4.4 방식으로 최종 footer ${stableMs}ms 확정 → ACK 후 관리창 종료`, {
      completionWatcher: completionEvidence.completionWatcher,
      resultTabId: probe.tabId,
      resultWindowId: resultTab.windowId,
      expectedInRuntime: probe.expectedInRuntime,
      expectedInAx: probe.expectedInAx,
      ackBeforeClose: true,
    });

    const advanced = await continueNextGoodsKey(
      latest,
      { tab: { id: probe.tabId, windowId: resultTab.windowId }, frameId: 0 },
      completionEvidence,
    );

    // Price extension closes its managed popup window deterministically after completeJob.
    const closeResult = await closeResultWindowV063(probe.tabId);

    const remaining = await loadActive();
    let closedWorkerWindows = [];
    if (!remaining || remaining.status !== "RUNNING" || remaining.job?.jobId !== initial.job?.jobId) {
      // Entire SINGLE job finished: mirror price extension closeManaged(job) and close owned A6/A21 workers too.
      closedWorkerWindows = await closeOwnedWorkspaceWindowsV063(resultTab.windowId);
    }
    return { ok: true, advanced, closeResult, closedWorkerWindows };
  }

  async function runPriceLifecycleWatcherV063(trigger, hintTabId = null) {
    const initial = await loadActive();
    if (!isSingleWaitV063(initial)) return false;
    const key = `${initial.job.jobId}:${currentGoodsKey(initial) || "none"}`;
    if (watchersV063.has(key)) return true;
    watchersV063.add(key);
    const since = Number(initial.stageStartedAt || initial.startedAt || Date.now());
    const startedAt = Date.now();
    let stableTabId = null;
    let stableSince = 0;
    let lastDiagnostics = [];
    try {
      await progress(initial, `A21 단품 · 실제 가격조정 확장 v0.4.4 결과창 탐색 방식 시작`, {
        completionWatcher: "HF22_PRICE_V044_ACTUAL_RESULT_LIFECYCLE",
        trigger,
        candidatePolicy: "created tab + opener + about:blank/javascript/blob + Shopling",
        stableTargetMs: STABLE_MS_V063,
      });

      while (Date.now() - startedAt < WAIT_LIMIT_MS_V063) {
        const active = await loadActive();
        if (!isSingleWaitV063(active) || active.job?.jobId !== initial.job?.jobId) return false;
        const candidates = await candidateTabsV063(active, hintTabId, since);
        const diagnostics = [];
        let definitive = null;

        for (const tab of candidates) {
          const probe = await inspectPriceStyleV063(tab.id);
          diagnostics.push({
            tabId: tab.id,
            windowId: tab.windowId,
            openerTabId: tab.openerTabId,
            url: String(tab.url || ""),
            processing: probe.processing,
            expectedFooter: probe.expectedFooter,
            expectedInRuntime: probe.expectedInRuntime,
            expectedInAx: probe.expectedInAx,
            documentComplete: probe.documentComplete,
            resultHeading: probe.resultHeading,
            contextCount: probe.contextCount,
            code: probe.code || null,
          });
          if (probe.ok && !probe.processing && probe.expectedFooter && probe.documentComplete) {
            definitive = probe;
            break;
          }
        }
        lastDiagnostics = diagnostics;

        if (!definitive) {
          stableTabId = null;
          stableSince = 0;
          await sleep(POLL_MS_V063);
          continue;
        }

        if (stableTabId !== definitive.tabId) {
          stableTabId = definitive.tabId;
          stableSince = Date.now();
        }
        const stableMs = Date.now() - stableSince;
        if (stableMs >= STABLE_MS_V063) {
          await detachAllV063();
          return finalizeAndCloseV063(initial, definitive, stableMs);
        }
        await sleep(POLL_MS_V063);
      }

      const latest = await loadActive();
      if (isSingleWaitV063(latest) && latest.job?.jobId === initial.job?.jobId) {
        await progress(latest, `A21 단품 · 가격조정 v0.4.4 방식 최종 footer 탐색 시간초과`, {
          code: "HF22_PRICE_V044_RESULT_TIMEOUT",
          completionWatcher: "HF22_PRICE_V044_ACTUAL_RESULT_LIFECYCLE",
          lastDiagnostics,
        });
      }
      return false;
    } finally {
      await detachAllV063();
      watchersV063.delete(key);
    }
  }

  if (chrome.webNavigation?.onCreatedNavigationTarget) {
    chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
      void (async () => {
        const active = await loadActive();
        if (!isSingleWaitV063(active) || !Number.isInteger(details?.tabId)) return;
        const related = await relatedWorkerTabIdsV063(active);
        if (!related.has(details.sourceTabId) && details.sourceTabId !== active.singlePopupTabId) return;
        const tab = await chrome.tabs.get(details.tabId).catch(() => null);
        if (tab) recordCreatedV063(tab);
        setTimeout(() => void runPriceLifecycleWatcherV063("createdNavigationTarget", details.tabId), 80);
      })();
    });
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === SINGLE_STAGE_V063 && String(message?.stage || "") === "RESULT_WAIT") {
      const hintTabId = Number.isInteger(sender?.tab?.id) ? sender.tab.id : null;
      setTimeout(() => void runPriceLifecycleWatcherV063("singleResultWait", hintTabId), 80);
    }
  });
})();
