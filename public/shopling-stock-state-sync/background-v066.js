importScripts("background-v059.js");

// HF25: authoritative SINGLE sale-status result scanner with visible diagnostics.
// - no HF20~HF24 SINGLE result watcher is imported
// - scans every exact aapi*.shopling.co.kr /prod_a/prod_status_trsmt.phtml tab while a SINGLE job is active
// - does not require opener/recent-tab heuristics to include an exact result tab
// - scans immediately when the service worker boots, so an already-open result can be recovered
// - logs each decisive step to the service-worker console
// - after terminal footer stability: ACK/advance first, then price-style closeManaged window removal
(() => {
  const VERSION_V066 = chrome.runtime.getManifest().version;
  const TAG = "[CommerceOS Stock HF25]";
  const POLL_MS = 300;
  const STABLE_MS = 2_500;
  const WAIT_MS = 95_000;
  const STAGE_MESSAGE = "STOCK_SINGLE_POPUP_STAGE_V011";
  const WORKSPACE_KEY = "commerceStockWorkspaceV030";
  const watchers = new Set();

  const log = (...args) => console.log(TAG, new Date().toISOString(), ...args);
  const warn = (...args) => console.warn(TAG, new Date().toISOString(), ...args);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function exactResultUrl(raw) {
    try {
      const url = new URL(String(raw || ""));
      const hostOk = url.hostname === "shopling.co.kr" || url.hostname.endsWith(".shopling.co.kr");
      return hostOk && /\/prod_a\/prod_status_trsmt\.phtml$/i.test(url.pathname);
    } catch {
      return false;
    }
  }

  function eligible(active) {
    return Boolean(
      active && active.status === "RUNNING" && active.job?.productKind === "SINGLE" &&
      ["A21_LIST", "A21_POPUP", "WAIT_A21_RESULT"].includes(String(active.stage || ""))
    );
  }

  function watcherKey(active) {
    return `${String(active?.job?.jobId || "none")}:${Number(active?.goodsKeyIndex || 0)}`;
  }

  async function listExactResultTabs(hintTabId = null) {
    const tabs = await chrome.tabs.query({}).catch((error) => {
      warn("tabs.query failed", String(error?.message || error));
      return [];
    });
    const exact = tabs.filter((tab) => Number.isInteger(tab?.id) && exactResultUrl(tab.url || tab.pendingUrl));
    exact.sort((a, b) => {
      if (a.id === hintTabId) return -1;
      if (b.id === hintTabId) return 1;
      return Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0);
    });
    return exact;
  }

  async function probe(tab) {
    const tabId = tab?.id;
    if (!Number.isInteger(tabId)) return { ok: false, code: "NO_TAB_ID" };
    const url = String(tab.url || tab.pendingUrl || "");
    if (!exactResultUrl(url)) return { ok: false, code: "NOT_EXACT_RESULT_URL", tabId, url };
    try {
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
            fallbackFooter: /상품판매상태\s*송신이\s*완료되었습니다/i.test(text) || /상품\s*수정\s*전송이\s*완료되었습니다/i.test(text),
            processing: /처리중입니다/i.test(text) || /잠시만\s*기다려주시기\s*바랍니다/i.test(text),
            countsBalanced: totals.length > 0 && totalCount === successCount + failureCount,
            totalCount,
            successCount,
            failureCount,
            readyState: String(document.readyState || ""),
            href: String(location.href || ""),
            title: String(document.title || ""),
            textLength: text.length,
            tail: text.slice(-1000),
          };
        },
      });
      const values = rows.map((row) => row?.result).filter(Boolean);
      const terminalFrame = values.find((row) => !row.processing && row.readyState === "complete" && (row.exactFooter || row.fallbackFooter)) || null;
      return {
        ok: values.length > 0,
        tabId,
        windowId: tab.windowId,
        url,
        frameCount: values.length,
        exactFooterFrames: values.filter((row) => row.exactFooter).length,
        processingFrames: values.filter((row) => row.processing).length,
        terminalFrame,
      };
    } catch (error) {
      return { ok: false, code: "EXECUTE_SCRIPT_FAILED", tabId, windowId: tab.windowId, url, error: String(error?.message || error) };
    }
  }

  async function removeWindow(windowId) {
    if (!Number.isInteger(windowId)) return { closed: false, mode: "NO_WINDOW" };
    const before = await chrome.windows.get(windowId).catch(() => null);
    if (!before) return { closed: true, mode: "ALREADY_GONE", windowId };
    try {
      await chrome.windows.remove(windowId);
    } catch (error) {
      warn("windows.remove threw", { windowId, error: String(error?.message || error) });
    }
    const after = await chrome.windows.get(windowId).catch(() => null);
    const result = { closed: !after, mode: !after ? "WINDOW" : "WINDOW_REMOVE_FAILED", windowId };
    log("window close result", result);
    return result;
  }

  async function closeManaged(resultTabId, resultWindowId, popupTabId, popupWindowId) {
    const out = [];
    const windows = [...new Set([resultWindowId, popupWindowId].filter(Number.isInteger))];
    log("closeManaged begin", { resultTabId, resultWindowId, popupTabId, popupWindowId, windows });
    for (const windowId of windows) out.push(await removeWindow(windowId));
    for (const tabId of [...new Set([resultTabId, popupTabId].filter(Number.isInteger))]) {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) continue;
      if (windows.includes(tab.windowId) && out.some((row) => row.windowId === tab.windowId && row.closed)) continue;
      try { await chrome.tabs.remove(tabId); } catch (error) { warn("tabs.remove threw", { tabId, error: String(error?.message || error) }); }
      out.push({ closed: !(await chrome.tabs.get(tabId).catch(() => null)), mode: "TAB_FALLBACK", tabId, windowId: tab.windowId });
    }
    log("closeManaged end", out);
    return out;
  }

  async function closeOwnedWorkersIfFinished(jobId, excludedWindowIds = []) {
    const remaining = await loadActive();
    if (remaining?.status === "RUNNING" && remaining.job?.jobId === jobId) return [];
    const stored = await chrome.storage.local.get(WORKSPACE_KEY).catch(() => ({}));
    const ws = stored?.[WORKSPACE_KEY] || null;
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
      const result = await removeWindow(windowId);
      if (result.closed) closed.push(windowId);
    }
    log("owned worker close", { jobId, closed });
    return closed;
  }

  async function finalize(initial, probe, stableMs) {
    const latest = await loadActive();
    if (!eligible(latest) || latest.job?.jobId !== initial.job?.jobId || Number(latest.goodsKeyIndex || 0) !== Number(initial.goodsKeyIndex || 0)) {
      warn("finalize stale active", { expectedJob: initial.job?.jobId, active: latest });
      return false;
    }
    const resultTab = await chrome.tabs.get(probe.tabId).catch(() => null);
    if (!resultTab) return false;
    const originalPopupTabId = Number.isInteger(latest.singlePopupTabId) ? latest.singlePopupTabId : null;
    const originalPopupWindowId = Number.isInteger(latest.singlePopupWindowId) ? latest.singlePopupWindowId : null;

    if (latest.stage !== "WAIT_A21_RESULT") {
      log("promote stage to WAIT_A21_RESULT from objective result", { from: latest.stage });
      latest.stage = "WAIT_A21_RESULT";
      latest.stageStartedAt = Date.now();
    }
    latest.singlePopupTabId = probe.tabId;
    latest.singlePopupWindowId = resultTab.windowId ?? null;
    latest.workTabs = { ...(latest.workTabs || {}), A21_POPUP: { tabId: probe.tabId, frameId: 0 } };
    await saveActive(latest);

    const frame = probe.terminalFrame || {};
    const evidence = {
      processing: false,
      productComplete: true,
      readyState: "complete",
      stableCompletionVerified: true,
      stableCompletionMs: stableMs,
      shoplingBatchComplete: true,
      exactProductStateFooterVerified: Boolean(frame.exactFooter),
      exactProductStateFooterText: frame.exactFooter ? "상품상태 변경 전송이 완료되었습니다." : "판매상태/상품수정 완료 footer",
      countsBalanced: Boolean(frame.countsBalanced),
      successCount: Number(frame.successCount || 0),
      failureCount: Number(frame.failureCount || 0),
      marketFailureCount: Number(frame.failureCount || 0),
      marketFailuresAdvisory: Number(frame.failureCount || 0) > 0,
      explicitFailure: false,
      completionWatcher: "HF25_VERBOSE_ALL_EXACT_RESULT_SCANNER",
      resultUrl: probe.url,
    };

    log("TERMINAL VERIFIED; ACK/advance first", { jobId: latest.job.jobId, stableMs, probe, evidence, originalPopupTabId, originalPopupWindowId });
    await progress(latest, `A21 단품 · HF25 실제 결과탭 완료 확정 → 성공 ACK 후 가격조정 closeManaged 방식 창 종료`, {
      completionWatcher: evidence.completionWatcher,
      resultTabId: probe.tabId,
      resultWindowId: resultTab.windowId,
      originalPopupTabId,
      originalPopupWindowId,
      resultUrl: probe.url,
      stableMs,
      successCount: evidence.successCount,
      failureCount: evidence.failureCount,
      ackBeforeClose: true,
    });

    const jobId = latest.job.jobId;
    const advanced = await continueNextGoodsKey(latest, { tab: { id: probe.tabId, windowId: resultTab.windowId }, frameId: 0 }, evidence);
    log("ACK/advance returned", advanced);
    const closeResults = await closeManaged(probe.tabId, resultTab.windowId, originalPopupTabId, originalPopupWindowId);
    const closedWorkers = await closeOwnedWorkersIfFinished(jobId, [resultTab.windowId, originalPopupWindowId].filter(Number.isInteger));
    return { ok: true, advanced, closeResults, closedWorkers };
  }

  async function runWatcher(trigger, hintTabId = null) {
    const initial = await loadActive();
    if (!eligible(initial)) {
      log("watch trigger ignored; no eligible SINGLE active", { trigger, hintTabId, activeStatus: initial?.status, productKind: initial?.job?.productKind, stage: initial?.stage });
      return false;
    }
    const key = watcherKey(initial);
    if (watchers.has(key)) {
      log("watcher already running", { key, trigger });
      return true;
    }
    watchers.add(key);
    log("WATCHER START", { key, trigger, hintTabId, jobId: initial.job?.jobId, barcode: initial.job?.barcode, stage: initial.stage, goodsKeyIndex: initial.goodsKeyIndex, popupTabId: initial.singlePopupTabId, popupWindowId: initial.singlePopupWindowId });

    const startedAt = Date.now();
    let stableTabId = null;
    let stableSince = 0;
    let lastSignature = "";
    try {
      while (Date.now() - startedAt < WAIT_MS) {
        const active = await loadActive();
        if (!eligible(active) || active.job?.jobId !== initial.job?.jobId || Number(active.goodsKeyIndex || 0) !== Number(initial.goodsKeyIndex || 0)) {
          log("WATCHER STOP; active changed", { key, status: active?.status, stage: active?.stage, jobId: active?.job?.jobId, goodsKeyIndex: active?.goodsKeyIndex });
          return false;
        }

        const candidates = await listExactResultTabs(hintTabId);
        const signature = JSON.stringify(candidates.map((tab) => ({ id: tab.id, windowId: tab.windowId, openerTabId: tab.openerTabId, url: tab.url })));
        if (signature !== lastSignature) {
          lastSignature = signature;
          log("exact result candidates", candidates.map((tab) => ({ id: tab.id, windowId: tab.windowId, openerTabId: tab.openerTabId, url: tab.url })));
        }

        let terminal = null;
        for (const tab of candidates) {
          const result = await probe(tab);
          if (!result.ok) warn("probe failed", result);
          else if (result.terminalFrame) {
            log("terminal frame found", result);
            terminal = result;
            break;
          }
        }

        if (!terminal) {
          stableTabId = null;
          stableSince = 0;
          await sleep(POLL_MS);
          continue;
        }
        if (stableTabId !== terminal.tabId) {
          stableTabId = terminal.tabId;
          stableSince = Date.now();
          log("terminal stability started", { tabId: stableTabId, requiredMs: STABLE_MS });
        }
        const stableMs = Date.now() - stableSince;
        if (stableMs >= STABLE_MS) return finalize(initial, terminal, stableMs);
        await sleep(POLL_MS);
      }
      warn("WATCHER TIMEOUT", { key, waitedMs: Date.now() - startedAt });
      return false;
    } catch (error) {
      console.error(TAG, "WATCHER EXCEPTION", error);
      return false;
    } finally {
      watchers.delete(key);
    }
  }

  chrome.tabs.onCreated.addListener((tab) => {
    if (Number.isInteger(tab?.id)) {
      if (exactResultUrl(tab.url || tab.pendingUrl)) log("exact result tab created", { id: tab.id, windowId: tab.windowId, url: tab.url || tab.pendingUrl });
      setTimeout(() => void runWatcher("tabs.onCreated", tab.id), 80);
    }
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const url = String(changeInfo.url || tab?.url || tab?.pendingUrl || "");
    if (exactResultUrl(url)) log("exact result tab updated", { tabId, windowId: tab?.windowId, status: changeInfo.status, url });
    if (exactResultUrl(url) || changeInfo.status === "complete") setTimeout(() => void runWatcher("tabs.onUpdated", tabId), 60);
  });
  if (chrome.webNavigation?.onCommitted) chrome.webNavigation.onCommitted.addListener((details) => {
    if (!Number.isInteger(details?.tabId) || !exactResultUrl(details.url)) return;
    log("exact result webNavigation committed", details);
    setTimeout(() => void runWatcher("webNavigation.onCommitted", details.tabId), 40);
  });
  if (chrome.webNavigation?.onCompleted) chrome.webNavigation.onCompleted.addListener((details) => {
    if (!Number.isInteger(details?.tabId) || !exactResultUrl(details.url)) return;
    log("exact result webNavigation completed", details);
    setTimeout(() => void runWatcher("webNavigation.onCompleted", details.tabId), 40);
  });
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== STAGE_MESSAGE) return;
    const stage = String(message?.stage || "");
    log("SINGLE stage message", { stage, senderTabId: sender?.tab?.id, jobId: message?.jobId });
    if (["SUBMIT_CLICKING", "RESULT_WAIT"].includes(stage)) {
      setTimeout(() => void runWatcher(`stage:${stage}`, Number.isInteger(sender?.tab?.id) ? sender.tab.id : null), 50);
    }
  });

  log("SERVICE WORKER BOOT", { version: VERSION_V066, background: "background-v066.js", authority: "HF25_VERBOSE_ALL_EXACT_RESULT_SCANNER" });
  setTimeout(() => void runWatcher("serviceWorkerBoot", null), 100);
  chrome.runtime.onStartup?.addListener(() => setTimeout(() => void runWatcher("runtime.onStartup", null), 100));
  chrome.runtime.onInstalled?.addListener(() => setTimeout(() => void runWatcher("runtime.onInstalled", null), 100));
})();
