importScripts("background-v041.js");

(() => {
  const VERSION = "0.4.4";
  const STATE_KEY = "commerceOsShoplingA21PriceOptionResendV020";
  const POLL_MS = 500;
  const STABLE_MS = 2_500;
  const WAIT_LIMIT_MS = 30 * 60 * 1000;
  const DEBUGGER_VERSION = "1.3";
  const attachedTabsV044 = new Set();
  const contextsByTabV044 = new Map();
  const createdTabsV044 = [];

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();

  async function loadStateV044() {
    const stored = await chrome.storage.local.get(STATE_KEY);
    return stored[STATE_KEY] || null;
  }

  async function saveStateV044(state) {
    if (!state) return null;
    state.version = VERSION;
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [STATE_KEY]: state });
    return state;
  }

  chrome.tabs.onCreated.addListener((tab) => {
    if (!Number.isInteger(tab?.id)) return;
    createdTabsV044.push({
      tabId: tab.id,
      openerTabId: Number.isInteger(tab.openerTabId) ? tab.openerTabId : null,
      createdAt: Date.now(),
      url: String(tab.pendingUrl || tab.url || ""),
      title: String(tab.title || ""),
    });
    if (createdTabsV044.length > 200) createdTabsV044.splice(0, createdTabsV044.length - 200);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const row = [...createdTabsV044].reverse().find((item) => item.tabId === tabId);
    if (!row) return;
    if (changeInfo.url || tab?.url) row.url = String(changeInfo.url || tab?.url || row.url || "");
    if (changeInfo.title || tab?.title) row.title = String(changeInfo.title || tab?.title || row.title || "");
  });

  chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = source?.tabId;
    if (!Number.isInteger(tabId) || !attachedTabsV044.has(tabId)) return;
    if (method === "Runtime.executionContextCreated") {
      const contextId = params?.context?.id;
      if (!Number.isInteger(contextId)) return;
      if (!contextsByTabV044.has(tabId)) contextsByTabV044.set(tabId, new Set());
      contextsByTabV044.get(tabId).add(contextId);
    }
    if (method === "Runtime.executionContextsCleared") contextsByTabV044.set(tabId, new Set());
  });

  chrome.debugger.onDetach.addListener((source) => {
    const tabId = source?.tabId;
    if (!Number.isInteger(tabId)) return;
    attachedTabsV044.delete(tabId);
    contextsByTabV044.delete(tabId);
  });

  async function attachV044(tabId) {
    if (!Number.isInteger(tabId) || tabId < 0) return false;
    if (attachedTabsV044.has(tabId)) return true;
    try {
      await chrome.debugger.attach({ tabId }, DEBUGGER_VERSION);
      attachedTabsV044.add(tabId);
      contextsByTabV044.set(tabId, new Set());
      await chrome.debugger.sendCommand({ tabId }, "Runtime.enable").catch(() => null);
      await chrome.debugger.sendCommand({ tabId }, "Page.enable").catch(() => null);
      await chrome.debugger.sendCommand({ tabId }, "Accessibility.enable").catch(() => null);
      await sleep(140);
      return true;
    } catch (error) {
      const message = String(error?.message || error || "");
      if (/already attached|another debugger/i.test(message)) {
        // v0.4.1 may still be releasing the same target. Retry on the next poll
        // instead of assuming that a foreign/previous attachment is readable.
        return false;
      }
      return false;
    }
  }

  async function detachV044(tabId) {
    if (!Number.isInteger(tabId) || !attachedTabsV044.has(tabId)) return;
    await chrome.debugger.detach({ tabId }).catch(() => null);
    attachedTabsV044.delete(tabId);
    contextsByTabV044.delete(tabId);
  }

  async function detachAllV044() {
    await Promise.all([...attachedTabsV044].map((tabId) => detachV044(tabId)));
  }

  async function detachJobV044(job) {
    const ids = [...new Set([job?.resultTabId, job?.popupTabId].filter(Number.isInteger))];
    await Promise.all(ids.map((tabId) => detachV044(tabId)));
  }

  const FRAME_EXPRESSION = `(() => {
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
      const priceFooter = /상품\\s*수정\\s*전송이\\s*완료되었습니다/i.test(text) || /상품\\s*수정\\s*전송\\s*완료/i.test(text);
      const optionFooter = /상품\\s*옵션\\s*수정\\s*전송이\\s*완료되었습니다/i.test(text) || /상품\\s*옵션\\s*수정\\s*전송\\s*완료/i.test(text);
      const resultHeading = /쇼핑몰\\s*상품(?:\\s*옵션)?\\s*수정\\s*전송\\s*결과/i.test(text) || /상품(?:\\s*옵션)?\\s*수정\\s*전송\\s*결과/i.test(text);
      return {
        ok: true,
        processing,
        priceFooter,
        optionFooter,
        resultHeading,
        readyState: String(document.readyState || ''),
        href: String(location.href || ''),
        title: String(document.title || ''),
        textLength: text.length,
      };
    } catch (error) {
      return { ok: false, error: String(error?.message || error || 'evaluate failed') };
    }
  })()`;

  async function evaluateOneV044(tabId, contextId, top = false) {
    try {
      const response = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
        expression: FRAME_EXPRESSION,
        returnByValue: true,
        awaitPromise: false,
        ...(Number.isInteger(contextId) ? { contextId } : {}),
      });
      const value = response?.result?.value;
      if (!value || typeof value !== "object") return null;
      return { ...value, top };
    } catch {
      return null;
    }
  }

  async function evaluateAllContextsV044(tabId) {
    const rows = [];
    const top = await evaluateOneV044(tabId, null, true);
    if (top) rows.push(top);
    const ids = [...(contextsByTabV044.get(tabId) || [])];
    for (const contextId of ids) {
      const row = await evaluateOneV044(tabId, contextId, false);
      if (row) rows.push(row);
    }
    return rows.filter((row) => row?.ok);
  }

  async function accessibilityTextV044(tabId) {
    try {
      const response = await chrome.debugger.sendCommand({ tabId }, "Accessibility.getFullAXTree", {});
      const chunks = [];
      for (const node of response?.nodes || []) {
        for (const value of [node?.name?.value, node?.value?.value, node?.description?.value]) {
          if (value) chunks.push(String(value));
        }
      }
      return norm(chunks.join(" "));
    } catch {
      return "";
    }
  }

  function expectedFooterRegex(mode) {
    return mode === "OPTION"
      ? /상품\s*옵션\s*수정\s*전송이\s*완료되었습니다|상품\s*옵션\s*수정\s*전송\s*완료/i
      : /상품\s*수정\s*전송이\s*완료되었습니다|상품\s*수정\s*전송\s*완료/i;
  }

  function plausibleTabV044(tab, job) {
    if (!tab || !Number.isInteger(tab.id)) return false;
    if (tab.id === job?.workerTabId) return false;
    const url = String(tab.url || tab.pendingUrl || "");
    const title = String(tab.title || "");
    const known = [job?.resultTabId, job?.popupTabId].includes(tab.id)
      || [job?.workerTabId, job?.popupTabId].includes(tab.openerTabId);
    if (known) return true;
    const created = createdTabsV044.find((row) => row.tabId === tab.id && row.createdAt >= Number(job?.createdAt || 0) - 5000);
    if (created && [job?.workerTabId, job?.popupTabId].includes(created.openerTabId)) return true;
    if (job?.monthlyScope) return false;
    return /shopling/i.test(url) || /샵플링|shopling/i.test(title) || /^about:blank/i.test(url);
  }

  async function candidateTabsV044(job) {
    const tabs = (await chrome.tabs.query({})).filter((tab) => plausibleTabV044(tab, job));
    const score = (tab) => {
      let value = 0;
      if (tab.id === job?.resultTabId) value += 100;
      if (tab.id === job?.popupTabId) value += 70;
      if ([job?.popupTabId, job?.workerTabId].includes(tab.openerTabId)) value += 50;
      if (/prodlinkage|shopling/i.test(String(tab.url || ""))) value += 15;
      if (/샵플링|shopling/i.test(String(tab.title || ""))) value += 10;
      const created = createdTabsV044.find((row) => row.tabId === tab.id);
      if (created && created.createdAt >= Number(job?.createdAt || 0) - 5000) value += 20;
      return value;
    };
    tabs.sort((a, b) => score(b) - score(a));
    return tabs.slice(0, 12);
  }

  async function inspectDefinitiveV044(job) {
    const candidates = await candidateTabsV044(job);
    const expectedRegex = expectedFooterRegex(job.mode);
    const diagnostics = [];
    let processingCandidate = null;
    let evidenceCandidate = null;

    for (const tab of candidates) {
      const attached = await attachV044(tab.id);
      if (!attached) {
        diagnostics.push(`tab ${tab.id} attach-wait`);
        continue;
      }
      const contexts = await evaluateAllContextsV044(tab.id);
      const axText = await accessibilityTextV044(tab.id);
      const processing = contexts.some((row) => row.processing) || /처리중입니다|잠시만\s*기다려주시기\s*바랍니다/i.test(axText);
      const expectedInRuntime = contexts.some((row) => job.mode === "OPTION" ? row.optionFooter : row.priceFooter);
      const expectedInAx = expectedRegex.test(axText);
      const expectedFooter = expectedInRuntime || expectedInAx;
      const topReady = contexts.some((row) => row.top && row.readyState === "complete");
      const matchingContextReady = contexts.some((row) => {
        const matched = job.mode === "OPTION" ? row.optionFooter : row.priceFooter;
        return matched && row.readyState === "complete";
      });
      const documentComplete = matchingContextReady || (expectedInAx && topReady);
      const resultHeading = contexts.some((row) => row.resultHeading) || /쇼핑몰\s*상품(?:\s*옵션)?\s*수정\s*전송\s*결과|상품(?:\s*옵션)?\s*수정\s*전송\s*결과/i.test(axText);
      const info = {
        tabId: tab.id,
        processing,
        expectedFooter,
        expectedInRuntime,
        expectedInAx,
        documentComplete,
        resultHeading,
        contextCount: contexts.length,
        diagnostic: `tab ${tab.id} ctx ${contexts.length} footer ${expectedInRuntime ? "runtime" : expectedInAx ? "ax" : "none"}`,
      };
      if (expectedFooter) return info;
      if (processing && !processingCandidate) processingCandidate = info;
      if (resultHeading && !evidenceCandidate) evidenceCandidate = info;
      diagnostics.push(info.diagnostic);
    }

    return processingCandidate || evidenceCandidate || {
      tabId: null,
      processing: false,
      expectedFooter: false,
      expectedInRuntime: false,
      expectedInAx: false,
      documentComplete: false,
      resultHeading: false,
      contextCount: 0,
      diagnostic: diagnostics.slice(0, 5).join(" | ") || "result target not found",
    };
  }

  const baseCompleteJobV041 = completeJob;

  completeJob = async function completeJobV044(jobId, priorMessage) {
    const initialState = await loadStateV044();
    const initialJob = initialState?.jobs?.find((item) => item.id === jobId);
    if (!initialState || !initialJob || initialJob.status !== "RUNNING") {
      return baseCompleteJobV041(jobId, priorMessage);
    }
    if (String(initialJob.stage || "") !== "RESULT_WAIT") {
      if (initialJob.monthlyScope) return; // No early generic-success shortcut for monthly prices.
      return baseCompleteJobV041(jobId, priorMessage);
    }

    const startedAt = Date.now();
    let stableSince = 0;

    while (Date.now() - startedAt < WAIT_LIMIT_MS) {
      const state = await loadStateV044();
      const job = state?.jobs?.find((item) => item.id === jobId);
      if (!state || state.state !== "RUNNING" || state.stopped || !job || job.status !== "RUNNING") {
        if (initialJob.monthlyParallelBatch) await detachJobV044(initialJob);
        else await detachAllV044();
        return;
      }

      const probe = await inspectDefinitiveV044(job);
      if (Number.isInteger(probe.tabId)) job.resultTabId = probe.tabId;

      if (!Number.isInteger(probe.tabId)) {
        stableSince = 0;
        job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 최종완료 타깃 재탐색 · 모든 프레임/접근성 트리 확인 중 · ${probe.diagnostic} v${VERSION}`;
        await saveStateV044(state);
        await sleep(POLL_MS);
        continue;
      }

      if (probe.processing) {
        stableSince = 0;
        job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} Shopling 처리중 확인 · 프레임/접근성 트리 기준 로딩 종료 대기 · ${probe.diagnostic} v${VERSION}`;
        await saveStateV044(state);
        await sleep(POLL_MS);
        continue;
      }

      if (!probe.expectedFooter || !probe.documentComplete) {
        stableSince = 0;
        const expectedLabel = job.mode === "OPTION" ? "‘상품옵션 수정 전송이 완료되었습니다.’" : "‘상품 수정 전송이 완료되었습니다.’";
        job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} ${expectedLabel} 확인 대기 · top/frame + Accessibility 동시 검사 · ${probe.diagnostic} v${VERSION}`;
        await saveStateV044(state);
        await sleep(POLL_MS);
        continue;
      }

      if (!stableSince) stableSince = Date.now();
      const stableMs = Date.now() - stableSince;
      const source = probe.expectedInRuntime ? "frame DOM" : "Accessibility";
      job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 최종완료 확정 중 · ${source} 완료 footer + document complete · ${Math.min(stableMs, STABLE_MS)}/${STABLE_MS}ms v${VERSION}`;
      await saveStateV044(state);

      if (stableMs >= STABLE_MS) {
        if (job.monthlyParallelBatch) await detachJobV044(job);
        else await detachAllV044();
        return baseCompleteJobV041(
          jobId,
          `${job.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 완료 · Shopling 작업별 최종 footer를 모든 frame/Accessibility에서 확인 후 다음 큐 진행 v${VERSION}`,
        );
      }
      await sleep(POLL_MS);
    }

    if (initialJob.monthlyParallelBatch) await detachJobV044(initialJob);
    else await detachAllV044();
    if (typeof failJob === "function") {
      return failJob(jobId, "V044_FRAME_AX_COMPLETION_TIMEOUT", "Shopling 결과창의 작업별 최종 완료 footer를 모든 frame/접근성 트리에서 30분 동안 확인하지 못했습니다.");
    }
  };

  const baseStartRunV041 = startRun;
  startRun = async function startRunV044(sourceTabId, testMode = false) {
    const result = await baseStartRunV041(sourceTabId, testMode);
    const state = await loadStateV044();
    if (!state) return result;
    state.version = VERSION;
    state.resultPolicy = "CDP_ALL_FRAMES_PLUS_ACCESSIBILITY_DEFINITIVE_FOOTER";
    await saveStateV044(state);
    return publicState(state);
  };
})();
