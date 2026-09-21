importScripts("background-v020.js");

(() => {
  const VERSION = "0.4.1";
  const STATE_KEY = "commerceOsShoplingA21PriceOptionResendV020";
  const POLL_MS = 500;
  const STABLE_MS = 1_800;
  const WAIT_LIMIT_MS = 30 * 60 * 1000;
  const DEBUGGER_VERSION = "1.3";
  const activeWatchers = new Set();
  const attachedTabs = new Set();
  const contextsByTab = new Map();
  const createdTabs = [];

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function loadState() {
    const stored = await chrome.storage.local.get(STATE_KEY);
    return stored[STATE_KEY] || null;
  }

  async function saveState(state) {
    if (!state) return null;
    state.version = VERSION;
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [STATE_KEY]: state });
    return state;
  }

  chrome.tabs.onCreated.addListener((tab) => {
    if (!Number.isInteger(tab?.id)) return;
    createdTabs.push({
      tabId: tab.id,
      openerTabId: Number.isInteger(tab.openerTabId) ? tab.openerTabId : null,
      windowId: Number.isInteger(tab.windowId) ? tab.windowId : null,
      createdAt: Date.now(),
      url: String(tab.pendingUrl || tab.url || ""),
      title: String(tab.title || ""),
    });
    if (createdTabs.length > 150) createdTabs.splice(0, createdTabs.length - 150);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const row = [...createdTabs].reverse().find((item) => item.tabId === tabId);
    if (!row) return;
    if (changeInfo.url || tab?.url) row.url = String(changeInfo.url || tab?.url || row.url || "");
    if (changeInfo.title || tab?.title) row.title = String(changeInfo.title || tab?.title || row.title || "");
  });

  chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = source?.tabId;
    if (!Number.isInteger(tabId) || !attachedTabs.has(tabId)) return;
    if (method === "Runtime.executionContextCreated") {
      const contextId = params?.context?.id;
      if (!Number.isInteger(contextId)) return;
      if (!contextsByTab.has(tabId)) contextsByTab.set(tabId, new Set());
      contextsByTab.get(tabId).add(contextId);
    }
    if (method === "Runtime.executionContextsCleared") contextsByTab.set(tabId, new Set());
  });

  chrome.debugger.onDetach.addListener((source) => {
    const tabId = source?.tabId;
    if (!Number.isInteger(tabId)) return;
    attachedTabs.delete(tabId);
    contextsByTab.delete(tabId);
  });

  function sortJobsPricesFirst(state) {
    if (!state?.jobs) return;
    state.jobs.sort((a, b) => {
      const rank = (mode) => mode === "PRICE" ? 0 : mode === "OPTION" ? 1 : 2;
      const byMode = rank(a.mode) - rank(b.mode);
      if (byMode) return byMode;
      return Number(a.batchIndex || 0) - Number(b.batchIndex || 0);
    });
  }

  monitorResult = async () => {};

  const baseStartRun = startRun;
  startRun = async function startRunV041(sourceTabId, testMode = false) {
    const result = await baseStartRun(sourceTabId, testMode);
    const state = await loadState();
    if (!state) return result;
    state.version = VERSION;
    state.resultPolicy = "CDP_ACTUAL_RESULT_DOCUMENT";
    sortJobsPricesFirst(state);
    await saveState(state);
    return publicState(state);
  };

  async function pumpV041() {
    const state = await loadState();
    if (!state || state.state !== "RUNNING" || state.stopped) return;
    if (state.jobs.some((job) => job.status === "RUNNING")) return;

    const next = state.jobs.find((job) => job.status === "QUEUED" && job.mode === "PRICE")
      || state.jobs.find((job) => job.status === "QUEUED" && job.mode === "OPTION")
      || state.jobs.find((job) => job.status === "QUEUED");

    if (!next) return finalizeOrPump();
    try {
      await launchJob(state, next);
    } catch (error) {
      next.status = "FAILED";
      next.stage = "FAILED";
      next.error = "V041_WINDOW_CREATE";
      next.message = error instanceof Error ? error.message : String(error);
      await saveState(state);
      await finalizeOrPump();
    }
  }
  pump = pumpV041;

  async function attach(tabId) {
    if (!Number.isInteger(tabId) || tabId < 0) return false;
    if (attachedTabs.has(tabId)) return true;
    try {
      await chrome.debugger.attach({ tabId }, DEBUGGER_VERSION);
      attachedTabs.add(tabId);
      contextsByTab.set(tabId, new Set());
      await chrome.debugger.sendCommand({ tabId }, "Runtime.enable").catch(() => null);
      await chrome.debugger.sendCommand({ tabId }, "Page.enable").catch(() => null);
      await sleep(100);
      return true;
    } catch {
      return false;
    }
  }

  async function detach(tabId) {
    if (!attachedTabs.has(tabId)) return;
    await chrome.debugger.detach({ tabId }).catch(() => null);
    attachedTabs.delete(tabId);
    contextsByTab.delete(tabId);
  }

  async function detachAll() {
    await Promise.all([...attachedTabs].map((tabId) => detach(tabId)));
  }

  function isPlausibleResultTab(tab, job, since) {
    if (!tab || !Number.isInteger(tab.id)) return false;
    const url = String(tab.url || tab.pendingUrl || "");
    const title = String(tab.title || "");
    const shoplingLike = /shopling/i.test(url) || /샵플링|shopling/i.test(title) || /^about:blank/i.test(url) || /^javascript:/i.test(url) || /^blob:/i.test(url);
    if (!shoplingLike) return false;
    if ([job?.workerTabId, job?.popupTabId, job?.resultTabId].includes(tab.id)) return true;
    if ([job?.workerTabId, job?.popupTabId].includes(tab.openerTabId)) return true;
    const created = createdTabs.find((row) => row.tabId === tab.id && row.createdAt >= since - 5000);
    if (created && [job?.workerTabId, job?.popupTabId].includes(created.openerTabId)) return true;
    if (job?.monthlyScope) return false;
    if (created && (/shopling/i.test(created.url) || /샵플링|shopling/i.test(created.title))) return true;
    return false;
  }

  async function candidateTabs(job, since) {
    const tabs = await chrome.tabs.query({});
    const candidates = tabs.filter((tab) => isPlausibleResultTab(tab, job, since));
    candidates.sort((a, b) => {
      const score = (tab) => {
        let value = 0;
        if (tab.id === job?.resultTabId) value += 50;
        if ([job?.popupTabId, job?.workerTabId].includes(tab.openerTabId)) value += 30;
        if (/샵플링|shopling/i.test(String(tab.title || ""))) value += 10;
        if (/shopling/i.test(String(tab.url || ""))) value += 10;
        if (/about:blank|javascript:|blob:/i.test(String(tab.url || ""))) value += 4;
        return value;
      };
      return score(b) - score(a);
    });
    return candidates;
  }

  const EVAL_EXPRESSION = `(() => {
    try {
      const norm = (v) => String(v ?? '').normalize('NFKC').replace(/\\s+/g, ' ').trim();
      try { window.scrollTo(0, Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0)); } catch {}
      try {
        for (const el of document.querySelectorAll('*')) {
          if (el && el.scrollHeight > el.clientHeight + 24) el.scrollTop = el.scrollHeight;
        }
      } catch {}
      const text = norm(document.body?.innerText || document.body?.textContent || document.documentElement?.innerText || '');
      const processing = /처리중입니다/i.test(text) || /잠시만\\s*기다려주시기\\s*바랍니다/i.test(text);
      const resultHeading = /쇼핑몰\\s*상품\\s*수정\\s*전송\\s*결과/i.test(text) || /상품\\s*수정\\s*전송\\s*결과/i.test(text);
      const successLabels = (text.match(/성공건수\\s*[:：]?\\s*[\\d,]+/gi) || []).length;
      const failLabels = (text.match(/실패건수\\s*[:：]?\\s*[\\d,]+/gi) || []).length;
      const outcomeRows = /성공여부/i.test(text) && /쇼핑몰상품코드/i.test(text);
      const footer = /상품\\s*수정\\s*전송이\\s*완료되었습니다/i.test(text) || /상품\\s*수정\\s*전송\\s*완료/i.test(text);
      const evidence = resultHeading || successLabels > 0 || failLabels > 0 || outcomeRows || footer;
      const strongEvidence = footer || ((successLabels > 0 || failLabels > 0) && outcomeRows);
      return {
        ok: true,
        processing,
        evidence,
        strongEvidence,
        footer,
        resultHeading,
        successLabels,
        failLabels,
        outcomeRows,
        href: String(location.href || ''),
        title: String(document.title || ''),
        readyState: document.readyState,
        textLength: text.length,
      };
    } catch (error) {
      return { ok: false, error: String(error?.message || error || 'evaluate failed') };
    }
  })()`;

  async function evaluateTab(tabId) {
    const values = [];
    const contextIds = [...(contextsByTab.get(tabId) || [])];
    const commands = contextIds.length ? contextIds.map((contextId) => ({ contextId })) : [{}];
    for (const extra of commands) {
      try {
        const response = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
          expression: EVAL_EXPRESSION,
          returnByValue: true,
          awaitPromise: false,
          ...extra,
        });
        const value = response?.result?.value;
        if (value && typeof value === "object") values.push(value);
      } catch { /* stale execution context */ }
    }
    return values;
  }

  async function inspect(job, since) {
    const tabs = await candidateTabs(job, since);
    const diagnostics = [];
    for (const tab of tabs) {
      const ok = await attach(tab.id);
      if (!ok) {
        diagnostics.push(`tab ${tab.id} attach-failed ${String(tab.url || "")}`);
        continue;
      }
      const values = await evaluateTab(tab.id);
      const readable = values.filter((value) => value?.ok);
      if (!readable.length) {
        diagnostics.push(`tab ${tab.id} no-readable-context ${String(tab.url || "")}`);
        continue;
      }
      const processing = readable.some((value) => value.processing);
      const evidence = readable.some((value) => value.evidence);
      const strongEvidence = readable.some((value) => value.strongEvidence);
      const footer = readable.some((value) => value.footer);
      if (processing || evidence) {
        return {
          tabId: tab.id,
          processing,
          evidence,
          strongEvidence,
          footer,
          readable,
          diagnostic: `tab ${tab.id} ${String(tab.url || readable[0]?.href || "")}`,
        };
      }
      diagnostics.push(`tab ${tab.id} readable-no-result ${String(tab.url || readable[0]?.href || "")}`);
    }
    return { tabId: null, processing: false, evidence: false, strongEvidence: false, footer: false, readable: [], diagnostic: diagnostics.slice(0, 4).join(" | ") };
  }

  async function watchResult(jobId) {
    if (!jobId || activeWatchers.has(jobId)) return;
    activeWatchers.add(jobId);
    const startedAt = Date.now();
    let sawProcessing = false;
    let stableSince = 0;
    try {
      while (Date.now() - startedAt < WAIT_LIMIT_MS) {
        const state = await loadState();
        const job = state?.jobs?.find((item) => item.id === jobId);
        if (!state || state.state !== "RUNNING" || !job || job.status !== "RUNNING" || state.stopped) return;
        if (String(job.stage || "") !== "RESULT_WAIT") {
          await sleep(150);
          continue;
        }

        const probe = await inspect(job, startedAt);
        if (Number.isInteger(probe.tabId)) job.resultTabId = probe.tabId;

        if (!Number.isInteger(probe.tabId)) {
          stableSince = 0;
          job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} CDP로 실제 결과 타깃 탐색 중 · ${probe.diagnostic || "후보 대기"} v${VERSION}`;
          await saveState(state);
          await sleep(POLL_MS);
          continue;
        }

        if (probe.processing) {
          sawProcessing = true;
          stableSince = 0;
          job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 실제 결과문서 처리중 직접 확인 · ${probe.diagnostic} · 로딩 종료 대기 v${VERSION}`;
          await saveState(state);
          await sleep(POLL_MS);
          continue;
        }

        if (!probe.evidence) {
          stableSince = 0;
          job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 결과 타깃 직접 연결됨 · 결과표 생성 대기 · ${probe.diagnostic} v${VERSION}`;
          await saveState(state);
          await sleep(POLL_MS);
          continue;
        }

        const completionEvidence = probe.strongEvidence || probe.footer || sawProcessing;
        if (!completionEvidence) {
          stableSince = 0;
          job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 결과표는 보이지만 완료 강신호 대기 · ${probe.diagnostic} v${VERSION}`;
          await saveState(state);
          await sleep(POLL_MS);
          continue;
        }

        if (!stableSince) stableSince = Date.now();
        const stableMs = Date.now() - stableSince;
        job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 실제 결과문서 로딩 종료 확인 · 안정화 ${Math.min(stableMs, STABLE_MS)}/${STABLE_MS}ms · ${probe.diagnostic} v${VERSION}`;
        await saveState(state);

        if (stableMs >= STABLE_MS) {
          const resultTabId = job.resultTabId;
          await detachAll();
          await completeJob(
            job.id,
            `${job.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 완료 · Chrome CDP로 실제 Shopling 결과문서 로딩 종료 확인 · 마켓별 결과 검증 없음 v${VERSION}`,
          );
          if (Number.isInteger(resultTabId)) await chrome.tabs.remove(resultTabId).catch(() => null);
          return;
        }

        await sleep(POLL_MS);
      }

      const state = await loadState();
      const job = state?.jobs?.find((item) => item.id === jobId);
      if (state && job && job.status === "RUNNING") {
        await detachAll();
        await failJob(job.id, "V041_CDP_RESULT_TIMEOUT", "Chrome CDP로 실제 Shopling 결과문서의 완료 상태를 30분 동안 확인하지 못했습니다.");
      }
    } finally {
      activeWatchers.delete(jobId);
    }
  }

  globalThis.commerceOsWakeA21MonthlyResult = async () => {
    const state = await loadState();
    const running = state?.jobs?.find((job) => job.monthlyScope && job.status === "RUNNING" && String(job.stage) === "RESULT_WAIT");
    if (running) void watchResult(running.id);
  };

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "A21_STAGE" && String(message.stage || "") === "RESULT_WAIT" && message.jobId) {
      setTimeout(() => void watchResult(String(message.jobId)), 10);
    }
    if (message?.type === "A21_GET_STATE") {
      setTimeout(async () => {
        const state = await loadState();
        const running = state?.jobs?.find((job) => job.status === "RUNNING" && String(job.stage || "") === "RESULT_WAIT");
        if (running) void watchResult(running.id);
      }, 0);
    }
    if (message?.type === "A21_STOP") setTimeout(() => void detachAll(), 0);
    return false;
  });
})();
