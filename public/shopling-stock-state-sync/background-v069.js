importScripts("background-v068.js");

// HF28 parallel checkpoint layer.
// Goal: overlap two independent verification jobs without converting the entire legacy
// stock engine from its proven single-active-state model in one risky step.
// Lane 1 runs normally until Shopling submission is objectively confirmed and its result
// page is in WAIT_A21_RESULT. At that point Lane 1 is detached into an isolated result
// watcher bound to the exact result tab. The global legacy slot is then released, a fresh
// Shopling window/workspace is created, and Lane 2 starts immediately. Lane 1 and Lane 2
// therefore overlap while Shopling processes results. Window closing is best-effort only;
// HF28 never waits for Lane 1 window closure to start or finish Lane 2.
(() => {
  const VERSION_V069 = chrome.runtime.getManifest().version;
  const TAG_V069 = "[CommerceOS Stock HF28]";
  const PARALLEL_START = "STOCK_SYNC_PARALLEL_START_V028";
  const PARALLEL_STATE_KEY = "commerceOsShoplingStockParallelV028";
  const WORKSPACE_KEY = "commerceStockWorkspaceV030";
  const POLL_MS = 250;
  const STABLE_MS = 2_500;
  const RESULT_TIMEOUT_MS = 30 * 60 * 1000;
  const coordinators = new Set();
  const detachedWatchers = new Set();
  const legacyFinishV069 = finish;

  const sleepV069 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const logV069 = (...args) => console.log(TAG_V069, new Date().toISOString(), ...args);
  const warnV069 = (...args) => console.warn(TAG_V069, new Date().toISOString(), ...args);

  async function loadParallelV069() {
    const stored = await chrome.storage.local.get(PARALLEL_STATE_KEY).catch(() => ({}));
    return stored?.[PARALLEL_STATE_KEY] || null;
  }

  async function saveParallelV069(state) {
    if (!state) {
      await chrome.storage.local.remove(PARALLEL_STATE_KEY).catch(() => null);
      return null;
    }
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [PARALLEL_STATE_KEY]: state });
    return state;
  }

  async function parallelStatusV069(state, phase, extra = {}) {
    if (!state) return;
    await broadcast("STOCK_SYNC_PARALLEL_STATUS", {
      batchId: state.batchId,
      status: state.status,
      phase,
      firstJobId: state.firstJobId,
      secondJobId: state.secondJobId,
      secondStarted: Boolean(state.secondStarted),
      detachedFirst: Boolean(state.detachedFirst),
      results: state.results || {},
      ignoreWindowClose: true,
      ...extra,
    });
  }

  function terminalOutcomeV069(value) {
    return ["SUCCEEDED", "FAILED", "UNCERTAIN"].includes(String(value || "").toUpperCase());
  }

  function exactResultUrlV069(raw) {
    try {
      const url = new URL(String(raw || ""));
      const hostOk = url.hostname === "shopling.co.kr" || url.hostname.endsWith(".shopling.co.kr");
      return hostOk && /\/prod_a\/prod_status_trsmt\.phtml$/i.test(url.pathname);
    } catch {
      return false;
    }
  }

  async function probeDetachedResultV069(tabId) {
    if (!Number.isInteger(tabId)) return { ok: false, code: "NO_TAB_ID" };
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return { ok: false, code: "RESULT_TAB_GONE", tabId };
    const url = String(tab.url || tab.pendingUrl || "");
    if (!exactResultUrlV069(url)) {
      return { ok: false, code: "RESULT_TAB_NOT_EXACT_YET", tabId, windowId: tab.windowId, url };
    }
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
        terminalFrame,
      };
    } catch (error) {
      return {
        ok: false,
        code: "DETACHED_EXECUTE_SCRIPT_FAILED",
        tabId,
        windowId: tab.windowId,
        url,
        error: String(error?.message || error),
      };
    }
  }

  async function updateParallelResultV069(batchId, result) {
    const state = await loadParallelV069();
    if (!state || state.batchId !== batchId) return state;
    state.results = {
      ...(state.results || {}),
      [result.jobId]: {
        outcome: result.outcome,
        message: result.message,
        finishedAt: result.finishedAt,
      },
    };
    const first = state.results?.[state.firstJobId]?.outcome;
    const second = state.results?.[state.secondJobId]?.outcome;
    if (terminalOutcomeV069(first) && terminalOutcomeV069(second)) {
      state.status = first === "SUCCEEDED" && second === "SUCCEEDED" ? "SUCCEEDED" : "FAILED";
      state.phase = "DONE";
    }
    await saveParallelV069(state);
    await parallelStatusV069(state, state.phase || "RESULT", {
      jobId: result.jobId,
      outcome: result.outcome,
    });
    return state;
  }

  async function publishDetachedResultV069(detached, outcome, message, evidence = {}) {
    const result = {
      jobId: detached.job.jobId,
      job: detached.job,
      outcome,
      message,
      evidence: {
        stage: "WAIT_A21_RESULT",
        history: detached.evidence || [],
        parallelVerification: true,
        parallelBatchId: detached.batchId,
        parallelLane: 1,
        detachedResultWatcher: "HF28_EXACT_TAB_DETACHED_WATCHER",
        windowCloseIgnored: true,
        ...evidence,
      },
      startedAt: detached.startedAt,
      finishedAt: Date.now(),
      version: VERSION_V069,
    };
    await updateParallelResultV069(detached.batchId, result);
    await broadcast("STOCK_SYNC_RESULT", result);
    return result;
  }

  async function watchDetachedFirstV069(detached) {
    const key = `${detached.batchId}:${detached.job.jobId}:${detached.resultTabId}`;
    if (detachedWatchers.has(key)) return true;
    detachedWatchers.add(key);
    logV069("DETACHED WATCHER START", {
      batchId: detached.batchId,
      jobId: detached.job.jobId,
      barcode: detached.job.barcode,
      resultTabId: detached.resultTabId,
      resultWindowId: detached.resultWindowId,
    });
    const startedAt = Date.now();
    let stableSince = 0;
    try {
      while (Date.now() - startedAt < RESULT_TIMEOUT_MS) {
        const state = await loadParallelV069();
        if (!state || state.batchId !== detached.batchId || state.status === "CANCELLED") return false;
        if (terminalOutcomeV069(state.results?.[detached.job.jobId]?.outcome)) return true;

        const probe = await probeDetachedResultV069(detached.resultTabId);
        if (!probe.ok) {
          if (probe.code === "RESULT_TAB_GONE") {
            await publishDetachedResultV069(
              detached,
              "UNCERTAIN",
              `${detached.job.barcode} 병렬 Lane 1 결과창이 사라져 최종 Shopling 완료문구를 확인하지 못했습니다.`,
              { code: "HF28_DETACHED_RESULT_TAB_GONE" },
            );
            return false;
          }
          stableSince = 0;
          await sleepV069(POLL_MS);
          continue;
        }

        if (!probe.terminalFrame) {
          stableSince = 0;
          await sleepV069(POLL_MS);
          continue;
        }
        if (!stableSince) stableSince = Date.now();
        const stableMs = Date.now() - stableSince;
        if (stableMs < STABLE_MS) {
          await sleepV069(POLL_MS);
          continue;
        }

        const frame = probe.terminalFrame;
        logV069("DETACHED TERMINAL VERIFIED", {
          batchId: detached.batchId,
          jobId: detached.job.jobId,
          stableMs,
          resultTabId: probe.tabId,
          resultWindowId: probe.windowId,
          successCount: frame.successCount,
          failureCount: frame.failureCount,
        });
        await publishDetachedResultV069(
          detached,
          "SUCCEEDED",
          `${detached.job.barcode} Shopling ${statusKorean(detached.job.desiredStatus)} 병렬 Lane 1 완료 · 결과창 닫힘 여부와 무관하게 최종 footer 확인`,
          {
            processing: false,
            readyState: "complete",
            stableCompletionVerified: true,
            stableCompletionMs: stableMs,
            shoplingBatchComplete: true,
            exactProductStateFooterVerified: Boolean(frame.exactFooter),
            countsBalanced: Boolean(frame.countsBalanced),
            successCount: Number(frame.successCount || 0),
            failureCount: Number(frame.failureCount || 0),
            marketFailureCount: Number(frame.failureCount || 0),
            marketFailuresAdvisory: Number(frame.failureCount || 0) > 0,
            explicitFailure: false,
            resultUrl: probe.url,
            resultTabId: probe.tabId,
            resultWindowId: probe.windowId,
            completionWatcher: "HF28_EXACT_TAB_DETACHED_WATCHER",
            closeAttempted: false,
          },
        );
        return true;
      }

      await publishDetachedResultV069(
        detached,
        "UNCERTAIN",
        `${detached.job.barcode} 병렬 Lane 1 결과대기가 30분을 넘어 실제 Shopling 상태 확인이 필요합니다.`,
        { code: "HF28_DETACHED_RESULT_TIMEOUT", resultWaitTimeoutMinutes: 30 },
      );
      return false;
    } catch (error) {
      warnV069("DETACHED WATCHER EXCEPTION", {
        batchId: detached.batchId,
        jobId: detached.job.jobId,
        error: String(error?.message || error),
      });
      await publishDetachedResultV069(
        detached,
        "UNCERTAIN",
        `${detached.job.barcode} 병렬 Lane 1 결과감시 중 예외가 발생했습니다.`,
        { code: "HF28_DETACHED_WATCHER_EXCEPTION", error: String(error?.message || error) },
      );
      return false;
    } finally {
      detachedWatchers.delete(key);
    }
  }

  async function openFreshSecondWindowV069(state) {
    // Lane 1 no longer needs its A6/A21 workspace after submission. Forget the workspace
    // registry only; do not close its physical windows. This forces the legacy preflight
    // for Lane 2 to build against a new focused Shopling window instead of reusing Lane 1.
    await chrome.storage.local.remove(WORKSPACE_KEY).catch(() => null);
    const created = await chrome.windows.create({
      url: "https://a.shopling.co.kr/",
      focused: true,
      type: "normal",
    }).catch(() => null);
    if (!created || !Number.isInteger(created.id)) {
      return { ok: false, code: "HF28_SECOND_WINDOW_CREATE_FAILED" };
    }
    state.secondAnchorWindowId = created.id;
    const anchorTab = Array.isArray(created.tabs) ? created.tabs.find((tab) => Number.isInteger(tab?.id)) : null;
    state.secondAnchorTabId = anchorTab?.id ?? null;
    await saveParallelV069(state);
    await sleepV069(1_000);
    if (Number.isInteger(state.secondAnchorTabId)) {
      await chrome.tabs.update(state.secondAnchorTabId, { active: true }).catch(() => null);
    }
    await chrome.windows.update(created.id, { focused: true }).catch(() => null);
    return { ok: true, windowId: created.id, tabId: state.secondAnchorTabId };
  }

  async function failSecondStartV069(state, response) {
    const job = state.jobs[1];
    const result = {
      jobId: job.jobId,
      job,
      outcome: "FAILED",
      message: response?.message || `${job.barcode} 병렬 Lane 2 시작에 실패했습니다.`,
      evidence: {
        code: response?.code || "HF28_SECOND_START_FAILED",
        parallelVerification: true,
        parallelBatchId: state.batchId,
        parallelLane: 2,
        windowCloseIgnored: true,
      },
      startedAt: Date.now(),
      finishedAt: Date.now(),
      version: VERSION_V069,
    };
    await updateParallelResultV069(state.batchId, result);
    await broadcast("STOCK_SYNC_RESULT", result);
    return result;
  }

  async function startSecondV069(state) {
    const latest = await loadParallelV069();
    if (!latest || latest.batchId !== state.batchId || latest.secondStarted) return latest;
    latest.phase = "OPENING_SECOND_WINDOW";
    await saveParallelV069(latest);
    await parallelStatusV069(latest, latest.phase);

    const anchor = await openFreshSecondWindowV069(latest);
    if (!anchor.ok) {
      await failSecondStartV069(latest, anchor);
      return latest;
    }

    const response = await start(latest.jobs[1]);
    if (!response?.ok) {
      await failSecondStartV069(latest, response);
      return latest;
    }

    latest.secondStarted = true;
    latest.phase = "PARALLEL_RUNNING";
    latest.secondStartedAt = Date.now();
    await saveParallelV069(latest);
    await parallelStatusV069(latest, latest.phase, {
      secondAnchorWindowId: latest.secondAnchorWindowId,
      secondAnchorTabId: latest.secondAnchorTabId,
      activeJobId: response.active?.job?.jobId || latest.secondJobId,
    });
    logV069("LANE 2 STARTED", {
      batchId: latest.batchId,
      jobId: latest.secondJobId,
      barcode: latest.jobs[1]?.barcode,
      anchorWindowId: latest.secondAnchorWindowId,
    });
    return latest;
  }

  async function detachFirstAndStartSecondV069(state, active) {
    const candidateTabId =
      (Number.isInteger(active.singleObservedResultTabId) && active.singleObservedResultTabId) ||
      (Number.isInteger(active.singlePopupTabId) && active.singlePopupTabId) ||
      (Number.isInteger(active.workTabs?.A21_POPUP?.tabId) && active.workTabs.A21_POPUP.tabId) ||
      null;
    if (!Number.isInteger(candidateTabId)) return false;
    const tab = await chrome.tabs.get(candidateTabId).catch(() => null);
    if (!tab || !exactResultUrlV069(tab.url || tab.pendingUrl)) return false;

    state.detachedFirst = {
      batchId: state.batchId,
      job: active.job,
      startedAt: active.startedAt,
      evidence: Array.isArray(active.evidence) ? [...active.evidence] : [],
      stage: active.stage,
      goodsKeyIndex: Number(active.goodsKeyIndex || 0),
      resultTabId: candidateTabId,
      resultWindowId: tab.windowId ?? null,
      resultUrl: String(tab.url || tab.pendingUrl || ""),
      detachedAt: Date.now(),
    };
    state.phase = "FIRST_RESULT_DETACHED";
    state.firstDetachedAt = Date.now();
    await saveParallelV069(state);
    await parallelStatusV069(state, state.phase, {
      firstResultTabId: candidateTabId,
      firstResultWindowId: tab.windowId ?? null,
      firstResultUrl: state.detachedFirst.resultUrl,
      windowCloseIgnored: true,
    });

    // Release the legacy single-active slot without clearing/closing Lane 1 windows.
    await saveActive(null);
    logV069("LANE 1 DETACHED; LEGACY SLOT RELEASED", {
      batchId: state.batchId,
      jobId: active.job?.jobId,
      barcode: active.job?.barcode,
      resultTabId: candidateTabId,
      resultWindowId: tab.windowId,
    });

    void watchDetachedFirstV069(state.detachedFirst);
    await startSecondV069(state);
    return true;
  }

  async function coordinateV069(batchId) {
    if (coordinators.has(batchId)) return true;
    coordinators.add(batchId);
    logV069("COORDINATOR START", { batchId });
    try {
      const startedAt = Date.now();
      while (Date.now() - startedAt < RESULT_TIMEOUT_MS) {
        const state = await loadParallelV069();
        if (!state || state.batchId !== batchId || state.status !== "RUNNING") return false;
        if (state.secondStarted) return true;

        const active = await loadActive();
        if (active?.status === "RUNNING" && active.job?.jobId === state.firstJobId) {
          if (active.stage === "WAIT_A21_RESULT") {
            const detached = await detachFirstAndStartSecondV069(state, active);
            if (detached) return true;
          }
          await sleepV069(POLL_MS);
          continue;
        }

        const last = await loadLastResult().catch(() => null);
        if (last?.jobId === state.firstJobId && terminalOutcomeV069(last.outcome)) {
          state.results = {
            ...(state.results || {}),
            [state.firstJobId]: {
              outcome: last.outcome,
              message: last.message,
              finishedAt: last.finishedAt,
            },
          };
          state.phase = "FIRST_FINISHED_BEFORE_DETACH";
          await saveParallelV069(state);
          await parallelStatusV069(state, state.phase, { firstOutcome: last.outcome });
          if (last.outcome === "SUCCEEDED") {
            await startSecondV069(state);
          } else {
            state.status = "FAILED";
            state.phase = "DONE";
            await saveParallelV069(state);
            await parallelStatusV069(state, state.phase);
          }
          return true;
        }

        await sleepV069(POLL_MS);
      }

      const state = await loadParallelV069();
      if (state && state.batchId === batchId && state.status === "RUNNING") {
        state.status = "FAILED";
        state.phase = "COORDINATOR_TIMEOUT";
        await saveParallelV069(state);
        await parallelStatusV069(state, state.phase);
      }
      return false;
    } finally {
      coordinators.delete(batchId);
    }
  }

  finish = async function finishV069(active, outcome, message, evidence = {}) {
    const result = await legacyFinishV069(active, outcome, message, {
      ...evidence,
      parallelWindowCloseGate: "IGNORED_HF28",
    });
    const batchId = String(active?.job?.parallelBatchId || "");
    if (batchId) {
      await updateParallelResultV069(batchId, result);
    }
    return result;
  };

  async function startParallelV069(message) {
    const batchId = String(message?.batchId || "").trim();
    const rawJobs = Array.isArray(message?.jobs) ? message.jobs : [];
    if (!batchId || rawJobs.length !== 2) {
      return { ok: false, code: "HF28_PARALLEL_TWO_JOBS_REQUIRED", message: "병렬 검증은 정확히 2건이 필요합니다." };
    }

    const active = await loadActive();
    if (active?.status === "RUNNING") {
      return { ok: false, code: "HF28_ACTIVE_JOB_EXISTS", message: `이미 ${active.job?.barcode || "다른 B코드"} 작업이 실행 중입니다.` };
    }
    const existing = await loadParallelV069();
    if (existing?.status === "RUNNING") {
      return { ok: false, code: "HF28_PARALLEL_BATCH_ALREADY_RUNNING", message: "이미 2-Lane 병렬 검증이 실행 중입니다." };
    }

    const jobs = rawJobs.map((job, index) => ({
      ...job,
      parallelVerification: true,
      parallelBatchId: batchId,
      parallelLane: index + 1,
      ignoreWindowClose: true,
      verificationOnly: true,
    }));
    if (String(jobs[0]?.productKind || "").toUpperCase() !== "SINGLE") {
      return { ok: false, code: "HF28_FIRST_LANE_SINGLE_REQUIRED", message: "HF28 첫 병렬 Lane은 단품 결과대기 분리 방식만 지원합니다." };
    }
    if (!jobs[0]?.jobId || !jobs[1]?.jobId || jobs[0].jobId === jobs[1].jobId) {
      return { ok: false, code: "HF28_PARALLEL_JOB_ID_INVALID", message: "병렬 작업 ID가 올바르지 않습니다." };
    }
    if (String(jobs[0]?.barcode || "") === String(jobs[1]?.barcode || "")) {
      return { ok: false, code: "HF28_SAME_BARCODE_PARALLEL_BLOCKED", message: "같은 B코드는 병렬 실행하지 않습니다." };
    }

    const state = {
      version: VERSION_V069,
      batchId,
      status: "RUNNING",
      phase: "STARTING_FIRST",
      startedAt: Date.now(),
      jobs,
      firstJobId: jobs[0].jobId,
      secondJobId: jobs[1].jobId,
      secondStarted: false,
      detachedFirst: null,
      results: {},
      ignoreWindowClose: true,
    };
    await saveParallelV069(state);
    await parallelStatusV069(state, state.phase);

    const first = await start(jobs[0]);
    if (!first?.ok) {
      state.status = "FAILED";
      state.phase = "FIRST_START_FAILED";
      await saveParallelV069(state);
      await parallelStatusV069(state, state.phase, { code: first?.code, message: first?.message });
      return { ok: false, code: first?.code || "HF28_FIRST_START_FAILED", message: first?.message || "첫 병렬 작업 시작 실패" };
    }

    state.phase = "FIRST_RUNNING_UNTIL_RESULT_WAIT";
    await saveParallelV069(state);
    await parallelStatusV069(state, state.phase, { activeJobId: first.active?.job?.jobId || jobs[0].jobId });
    void coordinateV069(batchId);
    return {
      ok: true,
      batchId,
      mode: "TWO_LANE_OVERLAP_AFTER_SUBMIT",
      firstJobId: state.firstJobId,
      secondJobId: state.secondJobId,
      ignoreWindowClose: true,
      message: "Lane 1 송신 접수 직후 결과대기를 분리하고 새 Shopling 창에서 Lane 2를 병렬 시작합니다.",
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== PARALLEL_START) return undefined;
    void startParallelV069(message)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({
        ok: false,
        code: "HF28_PARALLEL_START_EXCEPTION",
        message: String(error?.message || error || "HF28 병렬 시작 예외"),
      }));
    return true;
  });

  logV069("SERVICE WORKER HF28 PARALLEL LAYER BOOT", {
    version: VERSION_V069,
    background: "background-v069.js",
    mode: "TWO_LANE_OVERLAP_AFTER_SUBMIT",
    windowCloseGate: "IGNORED",
  });

  setTimeout(() => {
    void (async () => {
      const state = await loadParallelV069();
      if (!state || state.status !== "RUNNING") return;
      if (state.detachedFirst && !terminalOutcomeV069(state.results?.[state.firstJobId]?.outcome)) {
        void watchDetachedFirstV069(state.detachedFirst);
      }
      if (!state.secondStarted) void coordinateV069(state.batchId);
    })();
  }, 200);
})();
