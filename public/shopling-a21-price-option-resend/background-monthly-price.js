/* global chrome, collectMonthlyPricePage, collectMonthlyRegisteredMarketPage, inspectMonthlyRegisteredMarketFrame, advanceMonthlyRegisteredMarketPage,
 loadState, saveState, publicState, buildBatches, addJobs, baselinePopupTabs, pump, startRun */
importScripts("background-v044.js", "monthly-price-dom.js");

(() => {
  const ORIGIN = "https://commerce-os-ops-center.vercel.app";
  const SHOPLING_SOURCE_URL = "https://a.shopling.co.kr/main.phtml";
  const HISTORY = "commerceOsMonthlyPriceTransmissionHistoryV1";
  const BATCH_HISTORY = "commerceOsMonthlyPriceBatchHistoryV054";
  const MAX_MONTHLY_PARALLEL = 4;
  const MONTHLY_RETRY_GROUP_SIZE = 20;
  const MONTHLY_MAX_ATTEMPTS = 3;
  let startBusy = false;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const OPS_PAGE_PATTERN = `${ORIGIN}/china-order-manager*`;

  async function injectMonthlyPageBridge(tabId) {
    if (!Number.isInteger(tabId) || !chrome.scripting?.executeScript) return false;
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["monthly-price-page-bridge.js"],
      });
      const probe = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => typeof globalThis.chrome?.runtime?.sendMessage === "function",
      }).catch(() => []);
      return probe[0]?.result === true;
    } catch {
      return false;
    }
  }

  async function repairMonthlyPageBridges() {
    const tabs = await chrome.tabs.query({ url: OPS_PAGE_PATTERN }).catch(() => []);
    await Promise.all(tabs.filter((tab) => Number.isInteger(tab.id)).map((tab) => injectMonthlyPageBridge(tab.id)));
  }

  chrome.tabs.onUpdated?.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete") return;
    try {
      const url = new URL(String(tab?.url || ""));
      if (url.origin === ORIGIN && url.pathname.startsWith("/china-order-manager")) {
        setTimeout(() => void injectMonthlyPageBridge(tabId), 50);
      }
    } catch { /* ignore non-http tabs */ }
  });

  // Extension reloads invalidate the old isolated-world context in already-open
  // OPS tabs. Re-inject immediately when the service worker starts so the user
  // does not need to guess which tab needs to be reopened.
  setTimeout(() => void repairMonthlyPageBridges(), 0);
  function trusted(sender) {
    try { return sender.frameId === 0 && new URL(sender.url).origin === ORIGIN && new URL(sender.url).pathname.startsWith("/china-order-manager"); }
    catch { return false; }
  }
  function jobCovers(job, goodsKey) {
    return Array.isArray(job.goodsKeys) && job.goodsKeys.includes(goodsKey);
  }
  function modeOutcome(state, mode, goodsKey) {
    const jobs = state.jobs.filter((job) => job.monthlyScope && job.mode === mode && jobCovers(job, goodsKey));
    if (jobs.some((job) => job.status === "RELIST_REQUIRED")) return "RELIST_REQUIRED";
    if (jobs.some((job) => job.status === "UNCERTAIN")) return "UNCERTAIN";
    if (jobs.some((job) => Array.isArray(job.monthlySucceededGoodsKeys) && job.monthlySucceededGoodsKeys.includes(goodsKey))) return "SUCCEEDED";
    if (jobs.some((job) => job.status === "SUCCEEDED" && jobCovers(job, goodsKey))) return "SUCCEEDED";
    if (jobs.some((job) => ["QUEUED", "RUNNING"].includes(job.status))) return "RUNNING";
    return "MISSING";
  }
  function itemReport(state, meta) {
    const scoped = state.jobs.filter((job) => job.monthlyScope && jobCovers(job, meta.goodsKey));
    const priceOutcome = modeOutcome(state, "PRICE", meta.goodsKey);
    const optionOutcome = modeOutcome(state, "OPTION", meta.goodsKey);
    const selling = scoped.filter((job) => job.mode === "STATUS_SELLING" && job.status !== "SUPERSEDED");
    const restore = scoped.filter((job) => job.mode === "STATUS_SOLD_OUT" && job.monthlyFailureRollback !== true && job.status !== "SUPERSEDED");
    const rollback = scoped.filter((job) => job.mode === "STATUS_SOLD_OUT" && job.monthlyFailureRollback === true && job.status !== "SUPERSEDED");
    const allSucceeded = (rows) => rows.length > 0 && rows.every((job) => job.status === "SUCCEEDED");
    const sellingOk = !meta.needsSellingStatus || allSucceeded(selling);
    const restoreOk = !meta.restoreSoldOut || allSucceeded(restore);
    const rolledBack = rollback.some((job) => job.status === "SUCCEEDED");
    const rollbackPending = rollback.some((job) => ["QUEUED", "RUNNING"].includes(job.status));
    const relistRequired = priceOutcome === "RELIST_REQUIRED" || optionOutcome === "RELIST_REQUIRED";
    const reviewRequired = priceOutcome === "UNCERTAIN" || optionOutcome === "UNCERTAIN";
    const priceOk = priceOutcome === "SUCCEEDED";
    const optionOk = optionOutcome === "SUCCEEDED";
    const done = priceOk && optionOk && sellingOk && restoreOk;
    return {
      token: meta.token,
      fingerprint: meta.fingerprint,
      goodsKey: meta.goodsKey,
      itemId: meta.itemId,
      batchId: state.monthlyBatchId || meta.batchId || null,
      state: rollbackPending ? "RUNNING" : relistRequired ? "RELIST_REQUIRED" : reviewRequired ? "PARTIAL_FAILURE" : done ? "SUCCEEDED" : state.state === "STOPPED" ? "STOPPED" : "RUNNING",
      priceOnly: priceOk && !optionOk,
      priceAndOption: priceOk && optionOk,
      saleStatusActivated: sellingOk,
      saleStatusRestored: restoreOk,
      saleStatusRolledBack: rolledBack,
      relistRequired,
      reviewRequired,
      priceOutcome,
      optionOutcome,
      updatedAt: state.updatedAt,
    };
  }
  function batchReport(state) {
    const items = (state.monthlyItems || []).map((meta) => itemReport(state, meta));
    const terminal = items.length > 0 && items.every((row) => !["RUNNING", "STARTING"].includes(row.state));
    const scoped = state.jobs.filter((job) => job.monthlyScope && job.status !== "SUPERSEDED");
    const phase = ["STATUS_SELLING", "PRICE", "OPTION", "STATUS_SOLD_OUT"].find((mode) =>
      scoped.some((job) => job.mode === mode && ["QUEUED", "RUNNING"].includes(job.status)),
    ) || (state.state === "SUCCEEDED" ? "DONE" : "");
    return {
      batchId: state.monthlyBatchId,
      state: terminal ? (items.every((row) => row.state === "SUCCEEDED") ? "SUCCEEDED" : "PARTIAL_FAILURE") : state.state,
      phase,
      activeWindows: scoped.filter((job) => job.status === "RUNNING").length,
      retryingCount: scoped.filter((job) => ["PRICE", "OPTION"].includes(job.mode) && Number(job.monthlyAttempt || 1) > 1 && ["QUEUED", "RUNNING"].includes(job.status)).length,
      relistRequiredCount: items.filter((row) => row.relistRequired === true).length,
      itemCount: items.length,
      items,
      updatedAt: state.updatedAt,
    };
  }
  function report(state) {
    const meta = state.monthlyItems?.[0] || {
      itemId: state.monthlyItemId,
      token: state.monthlyToken,
      fingerprint: state.fingerprint,
      goodsKey: state.monthlyGoodsKey,
      needsSellingStatus: state.monthlyNeedsSellingStatus,
      restoreSoldOut: state.monthlyRestoreSoldOut,
    };
    return itemReport(state, meta);
  }
  async function remember(state) {
    if (!state?.monthlyToken && !state?.monthlyBatchId) return;
    const writes = {};
    if (state.monthlyToken) {
      const history = (await chrome.storage.local.get(HISTORY))[HISTORY] || {};
      const value = report(state);
      if (!(history[value.token]?.updatedAt > value.updatedAt)) {
        history[value.token] = value;
        writes[HISTORY] = history;
      }
    }
    if (state.monthlyBatchId) {
      const history = (await chrome.storage.local.get(BATCH_HISTORY))[BATCH_HISTORY] || {};
      const value = batchReport(state);
      if (!(history[value.batchId]?.updatedAt > value.updatedAt)) {
        history[value.batchId] = value;
        writes[BATCH_HISTORY] = history;
      }
    }
    if (Object.keys(writes).length) await chrome.storage.local.set(writes);
  }
  const legacyAddJobs = addJobs;
  function monthlyJob(state, batch, mode, extra = {}) {
    return {
      id: `job-${mode.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      batchId: batch.id,
      batchIndex: batch.index,
      mode,
      goodsKeys: [...batch.goodsKeys],
      status: extra.status || "QUEUED",
      stage: extra.stage || "OPENING",
      workerWindowId: null,
      workerTabId: null,
      workerFrameId: null,
      popupWindowId: null,
      popupTabId: null,
      popupFrameId: null,
      selectedRowCount: 0,
      totalResultCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      message: extra.message || "대기 중",
      error: "",
      monthlyScope: true,
      monthlyAttempt: Number(extra.monthlyAttempt || batch.monthlyAttempt || 1),
      monthlyRetrySource: extra.monthlyRetrySource || batch.monthlyRetrySource || null,
      monthlySucceededGoodsKeys: [],
      monthlyFailedGoodsKeys: [],
      monthlyOutcomeEvidence: null,
      monthlyFailureRollback: extra.monthlyFailureRollback === true,
      monthlyTargetedRollback: extra.monthlyTargetedRollback === true,
      monthlyNormalRestore: extra.monthlyNormalRestore === true,
    };
  }
  addJobs = function monthlyScopedJobs(state, batch) {
    if (!state.monthlyToken && !state.monthlyBatchId) return legacyAddJobs(state, batch);
    if (state.monthlyBatchId) {
      const modes = Array.isArray(batch.monthlyModes) && batch.monthlyModes.length ? batch.monthlyModes : ["PRICE", "OPTION"];
      for (const mode of modes) {
        const extra = mode === "STATUS_SOLD_OUT" && batch.monthlyFailureRollback
          ? { status: "DORMANT", stage: "FAILURE_ROLLBACK_DORMANT", message: "전송 실패 시에만 원래 품절상태로 복구", monthlyFailureRollback: true }
          : mode === "STATUS_SOLD_OUT"
            ? { monthlyNormalRestore: true }
            : {};
        state.jobs.push(monthlyJob(state, batch, mode, extra));
      }
      return;
    }
    const before = state.jobs.length;
    legacyAddJobs(state, batch);
    const added = state.jobs.splice(before).map((job) => ({ ...job, monthlyScope: true }));
    const price = added.find((job) => job.mode === "PRICE");
    const option = added.find((job) => job.mode === "OPTION");
    const statusBatch = { ...batch };
    if (state.monthlyNeedsSellingStatus) state.jobs.push(monthlyJob(state, statusBatch, "STATUS_SELLING"));
    if (price) state.jobs.push(price);
    if (option) state.jobs.push(option);
    if (state.monthlyNeedsSellingStatus) {
      state.jobs.push(monthlyJob(state, statusBatch, "STATUS_SOLD_OUT", state.monthlyRestoreSoldOut
        ? { monthlyNormalRestore: true }
        : { status: "DORMANT", stage: "FAILURE_ROLLBACK_DORMANT", message: "PRICE/OPTION 실패 시에만 원래 품절상태로 안전 복구", monthlyFailureRollback: true }));
    }
  };

  const legacyFinalizeOrPump = finalizeOrPump;
  finalizeOrPump = async function monthlyFinalizeOrPump() {
    const state = await loadState();
    if (state?.monthlyToken || state?.monthlyBatchId) return pump();
    return legacyFinalizeOrPump();
  };

  const legacyPump = pump;
  function activeMonthlyJobs(state) {
    return state.jobs.filter((job) => job.monthlyScope && job.status !== "SUPERSEDED");
  }
  function phaseJobs(state, mode, predicate = () => true) {
    return activeMonthlyJobs(state).filter((job) => job.mode === mode && predicate(job));
  }
  function terminalPhaseStatus(status) {
    return ["SUCCEEDED", "RELIST_REQUIRED", "UNCERTAIN"].includes(status);
  }
  function badGoodsForMode(state, mode) {
    const out = new Set();
    for (const job of state.jobs.filter((row) => row.monthlyScope && row.mode === mode && ["RELIST_REQUIRED", "UNCERTAIN"].includes(row.status))) {
      for (const key of job.goodsKeys || []) out.add(key);
    }
    return out;
  }
  function pruneOptionJobsAfterPrice(state) {
    const blocked = badGoodsForMode(state, "PRICE");
    if (!blocked.size) return;
    for (const job of state.jobs.filter((row) => row.monthlyScope && row.mode === "OPTION" && row.status === "QUEUED")) {
      job.goodsKeys = (job.goodsKeys || []).filter((key) => !blocked.has(key));
      if (!job.goodsKeys.length) {
        job.status = "SUPERSEDED";
        job.stage = "PRICE_TERMINAL_EXCLUDED";
        job.message = "PRICE 3단계 실패/결과불명 상품 제외";
      }
    }
  }
  function scheduleTargetedRollback(state, badGoods) {
    if (!badGoods.size || !Array.isArray(state.monthlyItems)) return;
    const soldOut = new Set(state.monthlyItems.filter((item) => item.needsSellingStatus).map((item) => item.goodsKey));
    const scheduled = new Set(state.monthlyRollbackScheduledKeys || []);
    const keys = [...badGoods].filter((key) => soldOut.has(key) && !scheduled.has(key));
    if (!keys.length) return;
    for (let i = 0; i < keys.length; i += 200) {
      const part = keys.slice(i, i + 200);
      const batch = {
        id: "targeted-rollback-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        index: state.batches.length + 1,
        goodsKeys: part,
        monthlyModes: ["STATUS_SOLD_OUT"],
      };
      state.batches.push(batch);
      state.jobs.push(monthlyJob(state, batch, "STATUS_SOLD_OUT", {
        status: "QUEUED",
        stage: "FAILURE_ROLLBACK_PENDING",
        message: "PRICE/OPTION 최종 실패 상품만 원래 품절상태로 복구",
        monthlyFailureRollback: true,
        monthlyTargetedRollback: true,
      }));
      for (const key of part) scheduled.add(key);
    }
    state.monthlyRollbackScheduledKeys = [...scheduled];
  }
  async function launchQueued(state, jobs) {
    let slots = Math.max(0, MAX_MONTHLY_PARALLEL - activeMonthlyJobs(state).filter((job) => job.status === "RUNNING").length);
    for (const job of jobs.filter((row) => row.status === "QUEUED")) {
      if (slots <= 0) break;
      try { await launchJob(state, job); slots -= 1; }
      catch (error) {
        job.status = "FAILED";
        job.stage = "FAILED";
        job.error = "MONTHLY_A21_WINDOW_CREATE_FAILED";
        job.message = error instanceof Error ? error.message : String(error);
        await saveState(state);
      }
    }
  }
  pump = async function monthlyPhaseParallelPump() {
    const state = await loadState();
    if (!state?.monthlyToken && !state?.monthlyBatchId) return legacyPump();
    if (!state || state.state !== "RUNNING" || state.stopped) return;
    const jobs = activeMonthlyJobs(state);
    const failed = jobs.find((job) => ["FAILED", "STOPPED"].includes(job.status) && job.monthlyFailureRollback !== true);
    if (failed) {
      if (jobs.some((job) => job.status === "RUNNING" && job.monthlyFailureRollback !== true)) return;
      for (const job of jobs) {
        if (job.status === "QUEUED" && job.monthlyFailureRollback !== true) {
          job.status = "STOPPED";
          job.stage = "BLOCKED_BY_PRIOR_PHASE";
          job.message = "인프라/창 제어 실패로 후속 전송 중단";
        }
      }
      const rollback = jobs.filter((job) => job.mode === "STATUS_SOLD_OUT" && job.monthlyFailureRollback === true);
      for (const job of rollback) {
        if (job.status === "DORMANT") {
          job.status = "QUEUED";
          job.stage = "FAILURE_ROLLBACK_PENDING";
          job.message = "후속 전송 실패 · 원래 품절상태로 복구";
        }
      }
      await saveState(state);
      if (rollback.some((job) => ["QUEUED", "RUNNING"].includes(job.status))) {
        await launchQueued(state, rollback);
        return;
      }
      state.state = "PARTIAL_FAILURE";
      await saveState(state);
      await remember(state);
      return;
    }
    const phases = [
      phaseJobs(state, "STATUS_SELLING"),
      phaseJobs(state, "PRICE"),
      phaseJobs(state, "OPTION"),
      phaseJobs(state, "STATUS_SOLD_OUT", (job) => job.monthlyFailureRollback !== true),
    ].filter((rows) => rows.length);
    for (const phase of phases) {
      const mode = phase[0]?.mode;
      if (phase.every((job) => terminalPhaseStatus(job.status))) {
        if (mode === "PRICE") {
          const bad = badGoodsForMode(state, "PRICE");
          pruneOptionJobsAfterPrice(state);
          scheduleTargetedRollback(state, bad);
        }
        if (mode === "OPTION") scheduleTargetedRollback(state, badGoodsForMode(state, "OPTION"));
        const targetedRollback = phaseJobs(state, "STATUS_SOLD_OUT", (job) => job.monthlyFailureRollback === true && job.monthlyTargetedRollback === true);
        if (targetedRollback.some((job) => ["FAILED", "STOPPED"].includes(job.status))) {
          state.state = "PARTIAL_FAILURE";
          await saveState(state);
          await remember(state);
          return;
        }
        if (targetedRollback.some((job) => ["QUEUED", "RUNNING"].includes(job.status))) {
          await saveState(state);
          await launchQueued(state, targetedRollback);
          return;
        }
        continue;
      }
      await launchQueued(state, phase);
      return;
    }
    const finalItems = (state.monthlyItems || []).map((meta) => itemReport(state, meta));
    state.state = finalItems.some((row) => row.state !== "SUCCEEDED") ? "PARTIAL_FAILURE" : "SUCCEEDED";
    await saveState(state);
    await remember(state);
  };
  function rowContainsGoodsKey(row, goodsKey) {
    const key = String(goodsKey);
    return String(row || "").split(/\D+/).includes(key);
  }
  function rowOutcomeForGoods(goodsKey, rows) {
    const matches = (rows || []).filter((row) => rowContainsGoodsKey(row, goodsKey));
    if (!matches.length) return "UNKNOWN";
    if (matches.some((row) => /실패|오류|에러/i.test(row))) return "FAILED";
    if (matches.some((row) => /성공|정상/i.test(row))) return "SUCCEEDED";
    return "UNKNOWN";
  }
  function retryChunkSize(attempt) {
    return attempt <= 1 ? MONTHLY_RETRY_GROUP_SIZE : 1;
  }
  async function scheduleMonthlyResultRetry(state, job, retryKeys, evidenceSource) {
    const attempt = Number(job.monthlyAttempt || 1);
    await closeManaged(job);
    if (attempt >= MONTHLY_MAX_ATTEMPTS) {
      job.status = "RELIST_REQUIRED";
      job.stage = "RELIST_REQUIRED";
      job.error = "MONTHLY_A21_RETRY_EXHAUSTED";
      job.message = job.mode + " 3단계 재전송까지 실패 · 삭제 후 재등록 필요";
      job.monthlyFailedGoodsKeys = [...retryKeys];
      await saveState(state);
      await pump();
      return;
    }
    job.status = "SUPERSEDED";
    job.stage = "RETRY_SPLIT";
    job.message = job.mode + " " + attempt + "단계 실패 · 실패 대상만 " + (attempt + 1) + "단계 재전송";
    const size = retryChunkSize(attempt);
    for (let i = 0; i < retryKeys.length; i += size) {
      const keys = retryKeys.slice(i, i + size);
      const batch = {
        id: "retry-" + job.mode.toLowerCase() + "-" + (attempt + 1) + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        index: state.batches.length + 1,
        goodsKeys: keys,
        monthlyModes: [job.mode],
        monthlyAttempt: attempt + 1,
        monthlyRetrySource: evidenceSource,
      };
      state.batches.push(batch);
      addJobs(state, batch);
    }
    await saveState(state);
    await pump();
  }

  globalThis.commerceOsMonthlyHandleDefinitiveResult = async (jobId, evidence = {}) => {
    const state = await loadState();
    const job = state?.jobs?.find((row) => row.id === jobId);
    if (!state || !job?.monthlyScope || !["PRICE", "OPTION"].includes(job.mode) || job.status !== "RUNNING") return false;

    const rows = Array.isArray(evidence.resultRows) ? evidence.resultRows : [];
    const outcomes = new Map(job.goodsKeys.map((key) => [key, rowOutcomeForGoods(key, rows)]));
    const fullCoverage = job.goodsKeys.every((key) => outcomes.get(key) !== "UNKNOWN");
    const explicitFailed = job.goodsKeys.filter((key) => outcomes.get(key) === "FAILED");
    const explicitSucceeded = job.goodsKeys.filter((key) => outcomes.get(key) === "SUCCEEDED");
    const failureCount = Number.isFinite(evidence.failureCount) ? Number(evidence.failureCount) : null;
    const successCount = Number.isFinite(evidence.successCount) ? Number(evidence.successCount) : null;
    const summaryFound = evidence.outcomeSummaryFound === true;
    const explicitSummarySuccess = failureCount === 0 && successCount !== null && successCount > 0;
    const fullRowSuccess = fullCoverage && explicitFailed.length === 0 && explicitSucceeded.length === job.goodsKeys.length;

    job.monthlyOutcomeEvidence = {
      attempt: Number(job.monthlyAttempt || 1),
      failureCount,
      successCount,
      summaryFound,
      fullCoverage,
      evidenceSource: String(evidence.evidenceSource || ""),
    };

    if ((failureCount ?? 0) > 0 || explicitFailed.length > 0) {
      if (fullCoverage && explicitFailed.length > 0) {
        job.monthlySucceededGoodsKeys = explicitSucceeded;
        job.monthlyFailedGoodsKeys = explicitFailed;
        await scheduleMonthlyResultRetry(state, job, explicitFailed, "ROW_EXPLICIT");
      } else {
        job.monthlyFailedGoodsKeys = [...job.goodsKeys];
        await scheduleMonthlyResultRetry(state, job, [...job.goodsKeys], "FAILED_GROUP_FALLBACK");
      }
      return true;
    }

    if (explicitSummarySuccess || fullRowSuccess) {
      job.monthlySucceededGoodsKeys = [...job.goodsKeys];
      await saveState(state);
      return false;
    }

    await closeManaged(job);
    job.status = "UNCERTAIN";
    job.stage = "RESULT_UNCERTAIN";
    job.error = "MONTHLY_A21_RESULT_UNCERTAIN";
    job.message = job.mode + " 결과창 완료는 확인했지만 GOODSKEY별 성공/실패를 확정하지 못해 자동 재전송하지 않음";
    await saveState(state);
    await pump();
    return true;
  };
  const legacySplitBatch = splitBatch;
  splitBatch = async function monthlySplitBatch(jobId, totalResultCount) {
    const state = await loadState();
    const job = state?.jobs?.find((item) => item.id === jobId);
    if (!state?.monthlyBatchId || !job?.monthlyScope) return legacySplitBatch(jobId, totalResultCount);
    if (job.goodsKeys.length <= 1) return failJob(jobId, "V020_TOO_MANY_ROWS", `1 GOODSKEY 결과가 ${totalResultCount}건으로 안전 한도를 초과했습니다.`);
    const mid = Math.ceil(job.goodsKeys.length / 2);
    job.status = "SUPERSEDED";
    job.stage = "SPLIT";
    await closeManaged(job);
    if (job.mode === "PRICE") {
      for (const peer of state.jobs.filter((row) => row.batchId === job.batchId && row.mode === "OPTION" && row.status === "QUEUED")) {
        peer.status = "SUPERSEDED"; peer.stage = "SPLIT";
      }
    }
    const modes = job.mode === "PRICE" ? ["PRICE", "OPTION"] : [job.mode];
    const halves = [job.goodsKeys.slice(0, mid), job.goodsKeys.slice(mid)];
    for (const keys of halves) {
      const batch = {
        id: `batch-split-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        index: state.batches.length + 1,
        goodsKeys: keys,
        monthlyModes: modes,
        monthlyFailureRollback: job.monthlyFailureRollback === true,
      };
      state.batches.push(batch);
      addJobs(state, batch);
    }
    await saveState(state);
    await pump();
  };

  const legacyStartRun = startRun;
  startRun = async function protectedManualStart(...args) {
    const previous = await loadState();
    if (previous?.monthlyToken) {
      await remember(previous);
      if (["RUNNING", "STARTING"].includes(previous.state)) throw new Error("월 가격조정 전송이 진행 중입니다. 해당 작업을 먼저 확인하세요.");
    }
    return legacyStartRun(...args);
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.commerceOsShoplingA21PriceOptionResendV020?.newValue?.monthlyToken || changes.commerceOsShoplingA21PriceOptionResendV020?.newValue?.monthlyBatchId)) void remember(changes.commerceOsShoplingA21PriceOptionResendV020.newValue);
  });
  async function readPriceSettings(goodsKey) {
    if (!/^\d{5,9}$/.test(goodsKey)) throw new Error("MONTHLY_PRICE_GOODSKEY_INVALID");
    const url = `https://a.shopling.co.kr/prod/prodShopInfo.phtml?mode=price_chg&prod_id=${goodsKey}`;
    const tab = await chrome.tabs.create({ url, active: false });
    let signature = "", previous = null;
    try {
      for (let attempt = 0; attempt < 35; attempt += 1) {
        await sleep(650);
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: collectMonthlyPricePage,
          args: [goodsKey],
        }).catch(() => []);
        const value = results[0]?.result;
        if (!value) continue;
        const next = JSON.stringify(value.rows);
        if (next === signature && previous) return value;
        signature = next;
        previous = value;
      }
      throw new Error("MONTHLY_PRICE_SHOPLING_LOGIN_OR_DOM_REQUIRED");
    } finally {
      if (Number.isInteger(tab?.id)) await chrome.tabs.remove(tab.id).catch(() => null);
    }
  }

  async function readRegisteredMarketPrices(goodsKey) {
    if (!/^\d{5,9}$/.test(goodsKey)) throw new Error("MONTHLY_PRICE_GOODSKEY_INVALID");
    const beforeTabs = await chrome.tabs.query({}).catch(() => []);
    const preexisting = new Set(beforeTabs.map((tab) => tab.id).filter(Number.isInteger));
    const root = await chrome.tabs.create({
      url: `https://a.shopling.co.kr/prod/prodLst.phtml?commerce_os_monthly_market_read=1&commerce_os_monthly_market_goods=${goodsKey}`,
      active: false,
    });
    if (!Number.isInteger(root?.id)) throw new Error("MONTHLY_PRICE_REGISTERED_MALL_TAB_REQUIRED");

    const owned = new Set([root.id]);
    let activeTabId = root.id;
    let signature = "";
    let previous = null;
    let lastState = "";
    let repeatedTerminal = 0;
    let lastDiagnostic = "INIT";

    const discoverChildren = async () => {
      const tabs = await chrome.tabs.query({}).catch(() => []);
      for (const tab of tabs) {
        if (!Number.isInteger(tab.id) || preexisting.has(tab.id) || owned.has(tab.id)) continue;
        if (Number.isInteger(tab.openerTabId) && owned.has(tab.openerTabId)) owned.add(tab.id);
      }
      const candidates = tabs
        .filter((tab) => Number.isInteger(tab.id) && owned.has(tab.id) && String(tab.url || "").startsWith("https://a.shopling.co.kr/"))
        .sort((a, b) => Number(b.id) - Number(a.id));
      const child = candidates.find((tab) => tab.id !== root.id);
      if (Number.isInteger(child?.id)) activeTabId = child.id;
    };

    const candidateIds = () => [activeTabId, ...[...owned].reverse()]
      .filter((id, index, list) => Number.isInteger(id) && list.indexOf(id) === index);

    async function seedIdentity(tabId) {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: (key) => {
          try { sessionStorage.setItem("commerceOsMonthlyRegisteredMallGoodsKey", key); return true; } catch { return false; }
        },
        args: [goodsKey],
      }).catch(() => []);
    }

    async function collectFromAllFrames(tabId) {
      await seedIdentity(tabId);
      const parsed = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: collectMonthlyRegisteredMarketPage,
        args: [goodsKey],
      }).catch(() => []);
      return parsed.map((entry) => ({ frameId: entry.frameId, value: entry.result })).filter((entry) => entry.value?.marketRows?.length);
    }

    async function bestActionFrame() {
      let best = null;
      for (const tabId of candidateIds()) {
        await seedIdentity(tabId);
        const probes = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: inspectMonthlyRegisteredMarketFrame,
          args: [goodsKey],
        }).catch(() => []);
        for (const entry of probes) {
          const value = entry?.result;
          if (!value || !Number.isFinite(Number(value.score))) continue;
          const candidate = { tabId, frameId: entry.frameId, ...value };
          if (!best || Number(candidate.score) > Number(best.score)) best = candidate;
        }
      }
      return best;
    }

    try {
      for (let attempt = 0; attempt < 90; attempt += 1) {
        await sleep(attempt < 4 ? 650 : 450);
        await discoverChildren();

        for (const tabId of candidateIds()) {
          const matches = await collectFromAllFrames(tabId);
          for (const match of matches) {
            const value = match.value;
            activeTabId = tabId;
            const next = JSON.stringify(value.marketRows);
            if (next === signature && previous) return value;
            signature = next;
            previous = value;
          }
        }

        const target = await bestActionFrame();
        if (!target) {
          lastDiagnostic = "FRAME_NOT_FOUND";
          continue;
        }
        activeTabId = target.tabId;
        lastDiagnostic = `${target.state}@${target.pageUrl || ""}`;
        if (target.state === "LOGIN_REQUIRED") throw new Error("MONTHLY_PRICE_SHOPLING_LOGIN_OR_DOM_REQUIRED");

        const advanced = await chrome.scripting.executeScript({
          target: Number.isInteger(target.frameId) ? { tabId: target.tabId, frameIds: [target.frameId] } : { tabId: target.tabId },
          func: advanceMonthlyRegisteredMarketPage,
          args: [goodsKey],
        }).catch(() => []);
        const state = String(advanced[0]?.result?.state || target.state || "FRAME_ACTION_EMPTY");
        lastDiagnostic = `${state}@${advanced[0]?.result?.pageUrl || target.pageUrl || ""}`;
        if (state === "LOGIN_REQUIRED") throw new Error("MONTHLY_PRICE_SHOPLING_LOGIN_OR_DOM_REQUIRED");

        const terminal = [
          "SEARCH_FIELD_MISSING",
          "SEARCH_INPUT_MISSING",
          "SEARCH_BUTTON_MISSING",
          "DETAIL_LINK_MISSING",
          "REGISTERED_VIEW_CONTROL_MISSING",
          "INVALID_PAGE",
          "INVALID_FRAME",
        ].includes(state);
        if (terminal && state === lastState) repeatedTerminal += 1;
        else repeatedTerminal = terminal ? 1 : 0;
        lastState = state;
        if (repeatedTerminal >= 4) {
          throw new Error(`MONTHLY_PRICE_REGISTERED_MALL_VIEW_REQUIRED:${state}`);
        }

        await discoverChildren();
      }
      throw new Error(`MONTHLY_PRICE_REGISTERED_MALL_VIEW_TIMEOUT:${lastDiagnostic}`);
    } finally {
      for (const tabId of [...owned]) {
        if (Number.isInteger(tabId)) await chrome.tabs.remove(tabId).catch(() => null);
      }
    }
  }
  async function readPrices(goodsKey, includeRegisteredMarket = false) {
    const price = await readPriceSettings(goodsKey);
    if (!includeRegisteredMarket) return price;
    const market = await readRegisteredMarketPrices(goodsKey);
    return { ...price, ...market, goodsKey };
  }

  async function canonicalTransmission(payload) {
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(payload.month) || !/^[0-9a-f-]{36}$/.test(payload.token) || !/^[0-9a-f-]{36}$/.test(payload.runId)) throw new Error("MONTHLY_PRICE_TRANSMISSION_SCOPE_INVALID");
    const response = await fetch(`${ORIGIN}/api/china-order-manager/monthly-price?month=${payload.month}&runId=${encodeURIComponent(payload.runId)}`, { cache: "no-store", credentials: "omit" });
    const body = await response.json();
    const item = body?.items?.find((row) => row.id === payload.itemId && row.transmission?.token === payload.token);
    if (!response.ok || !body.ok || body.run?.id !== payload.runId || !item || item.state !== "RESENDING" || item.plan?.fingerprint !== payload.fingerprint || !/^\d{5,9}$/.test(item.goodsKey)) throw new Error("MONTHLY_PRICE_SERVER_SCOPE_NOT_VERIFIED");
    return item;
  }
  async function canonicalBatch(payload) {
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(payload.month) || !/^[0-9a-f-]{36}$/.test(payload.runId) || !/^[0-9a-f-]{36}$/.test(payload.batchId)) throw new Error("MONTHLY_PRICE_BATCH_SCOPE_INVALID");
    if (!Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > 5000) throw new Error("MONTHLY_PRICE_BATCH_ITEMS_INVALID");
    const response = await fetch(`${ORIGIN}/api/china-order-manager/monthly-price?month=${payload.month}&runId=${encodeURIComponent(payload.runId)}`, { cache: "no-store", credentials: "omit" });
    const body = await response.json();
    if (!response.ok || !body.ok || body.run?.id !== payload.runId) throw new Error("MONTHLY_PRICE_BATCH_SERVER_SCOPE_NOT_VERIFIED");
    const ids = new Set(), tokens = new Set(), goodsKeys = new Set();
    const verified = [];
    for (const requested of payload.items) {
      if (!/^[0-9a-f-]{36}$/.test(String(requested.itemId || "")) || !/^[0-9a-f-]{36}$/.test(String(requested.token || "")) || !/^[0-9a-f]{64}$/.test(String(requested.fingerprint || ""))) throw new Error("MONTHLY_PRICE_BATCH_ITEM_SCOPE_INVALID");
      const item = body.items?.find((row) => row.id === requested.itemId && row.transmission?.token === requested.token);
      if (!item || item.state !== "RESENDING" || item.plan?.fingerprint !== requested.fingerprint || item.transmission?.batchId !== payload.batchId || !/^\d{5,9}$/.test(item.goodsKey)) throw new Error("MONTHLY_PRICE_BATCH_SERVER_SCOPE_NOT_VERIFIED");
      if (ids.has(item.id) || tokens.has(requested.token) || goodsKeys.has(item.goodsKey)) throw new Error("MONTHLY_PRICE_BATCH_DUPLICATE_SCOPE");
      ids.add(item.id); tokens.add(requested.token); goodsKeys.add(item.goodsKey);
      verified.push({
        itemId: item.id,
        token: requested.token,
        fingerprint: requested.fingerprint,
        goodsKey: item.goodsKey,
        needsSellingStatus: item.plan.saleStatusTransition?.target === "B",
        restoreSoldOut: item.plan.saleStatusTransition?.restoreAfterTransmission === true,
      });
    }
    return verified;
  }
  async function startMonthlyBatch(payload) {
    if (startBusy) throw new Error("MONTHLY_PRICE_EXTENSION_BUSY");
    startBusy = true;
    try {
      const history = (await chrome.storage.local.get(BATCH_HISTORY))[BATCH_HISTORY] || {};
      const current = await loadState();
      if (current?.monthlyBatchId === payload.batchId) { await remember(current); return batchReport(current); }
      if (history[payload.batchId]) return history[payload.batchId];
      if (current?.state === "RUNNING") throw new Error("MONTHLY_PRICE_EXTENSION_BUSY");
      const items = await canonicalBatch(payload);
      if (payload.newClaim !== true) throw new Error("MONTHLY_PRICE_BATCH_HISTORY_MISSING");
      const tabs = await chrome.tabs.query({ url: "https://a.shopling.co.kr/*" });
      const source = tabs.find((tab) => /shopling\.co\.kr\//.test(tab.url || "") && !/goods_mallMdfy_trsmt|prodShopInfo/.test(tab.url || ""));
      const sourceUrl = source?.url || SHOPLING_SOURCE_URL;
      if (current?.monthlyToken || current?.monthlyBatchId) await remember(current);
      const state = {
        version: "0.5.10",
        runId: `monthly-batch-${payload.batchId}`,
        monthlyBatchId: payload.batchId,
        monthlyItems: items,
        state: "RUNNING",
        testMode: false,
        fingerprint: payload.batchId,
        goodsKeyCount: items.length,
        fullGoodsKeyCount: items.length,
        mallCheckCount: 0,
        sourceUrl,
        baselinePopupTabIds: await baselinePopupTabs(),
        batches: [],
        jobs: [],
        stopped: false,
        startedAt: Date.now(),
        updatedAt: Date.now(),
      };
      for (const batch of buildBatches(items)) {
        const scoped = { ...batch, monthlyModes: ["PRICE", "OPTION"], monthlyAttempt: 1 };
        state.batches.push(scoped); addJobs(state, scoped);
      }
      const soldOut = items.filter((item) => item.needsSellingStatus);
      for (const batch of buildBatches(soldOut)) {
        const selling = { ...batch, monthlyModes: ["STATUS_SELLING"] };
        state.batches.push(selling); addJobs(state, selling);
        const rollback = { ...batch, id: `rollback-${batch.id}`, monthlyModes: ["STATUS_SOLD_OUT"], monthlyFailureRollback: true };
        state.batches.push(rollback); addJobs(state, rollback);
      }
      const normalRestore = items.filter((item) => item.restoreSoldOut);
      for (const batch of buildBatches(normalRestore)) {
        const restore = { ...batch, id: `restore-${batch.id}`, monthlyModes: ["STATUS_SOLD_OUT"] };
        state.batches.push(restore); addJobs(state, restore);
      }
      await saveState(state); await remember(state); await pump();
      return batchReport(await loadState());
    } finally { startBusy = false; }
  }
  async function batchStatus(payload) {
    await globalThis.commerceOsWakeA21MonthlyResult?.();
    const current = await loadState();
    if (current?.monthlyBatchId === payload.batchId) { await remember(current); return batchReport(current); }
    return (await chrome.storage.local.get(BATCH_HISTORY))[BATCH_HISTORY]?.[payload.batchId] || { batchId: payload.batchId, state: "MISSING", items: [] };
  }

  async function startMonthly(payload) {
    if (startBusy) throw new Error("MONTHLY_PRICE_EXTENSION_BUSY");
    startBusy = true;
    try {
      const item = await canonicalTransmission(payload);
      const history = (await chrome.storage.local.get(HISTORY))[HISTORY] || {};
      const current = await loadState();
      if (current?.monthlyToken === payload.token) { await remember(current); return report(current); }
      if (history[payload.token]) return history[payload.token];
      if (payload.newClaim !== true) throw new Error("MONTHLY_PRICE_TRANSMISSION_HISTORY_MISSING");
      if (current?.state === "RUNNING") throw new Error("MONTHLY_PRICE_EXTENSION_BUSY");
      const tabs = await chrome.tabs.query({ url: "https://a.shopling.co.kr/*" });
      const source = tabs.find((tab) => /shopling\.co\.kr\//.test(tab.url || "") && !/goods_mallMdfy_trsmt|prodShopInfo/.test(tab.url || ""));
      const sourceUrl = source?.url || SHOPLING_SOURCE_URL;
      if (current?.monthlyToken) await remember(current);
      const batches = buildBatches([{ goodsKey: item.goodsKey }]);
      const state = { version: "0.5.10", runId: `monthly-${payload.token}`, monthlyToken: payload.token, monthlyGoodsKey: item.goodsKey,
        monthlyNeedsSellingStatus: item.plan.saleStatusTransition?.target === "B",
        monthlyRestoreSoldOut: item.plan.saleStatusTransition?.restoreAfterTransmission === true,
        state: "RUNNING", testMode: false, fingerprint: payload.fingerprint, goodsKeyCount: 1, fullGoodsKeyCount: 1,
        mallCheckCount: item.plan.targets.filter((row) => row.mallKey).length, sourceUrl,
        baselinePopupTabIds: await baselinePopupTabs(), batches, jobs: [], stopped: false, startedAt: Date.now(), updatedAt: Date.now() };
      for (const batch of batches) addJobs(state, batch);
      // Persist the token before opening any transmitting window. Recovery never
      // silently falls back to the old unscoped latest-proposal PLAN_URL.
      await saveState(state); await remember(state); await pump();
      return report(await loadState());
    } finally { startBusy = false; }
  }
  async function status(payload) {
    await globalThis.commerceOsWakeA21MonthlyResult?.();
    const current = await loadState();
    if (current?.monthlyToken === payload.token) { await remember(current); return report(current); }
    return (await chrome.storage.local.get(HISTORY))[HISTORY]?.[payload.token] || { token: payload.token, fingerprint: payload.fingerprint, goodsKey: payload.goodsKey, state: "MISSING", priceOnly: false, priceAndOption: false };
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!String(message?.type || "").startsWith("MONTHLY_PRICE_")) return false;
    if (!trusted(sender)) { sendResponse({ ok: false, error: "MONTHLY_PRICE_SENDER_REJECTED" }); return false; }
    void (async () => {
      try {
        const payload = message.payload || {};
        if (message.type === "MONTHLY_PRICE_PING") return sendResponse({ ok: true, version: "0.5.10" });
        if (message.type === "MONTHLY_PRICE_READ") return sendResponse({ ok: true, observation: await readPrices(String(payload.goodsKey || ""), false) });
        if (message.type === "MONTHLY_PRICE_MARKET_READ") return sendResponse({ ok: true, observation: await readPrices(String(payload.goodsKey || ""), true) });
        if (message.type === "MONTHLY_PRICE_START") return sendResponse({ ok: true, report: await startMonthly(payload) });
        if (message.type === "MONTHLY_PRICE_STATUS") return sendResponse({ ok: true, report: await status(payload) });
        if (message.type === "MONTHLY_PRICE_BATCH_START") return sendResponse({ ok: true, report: await startMonthlyBatch(payload) });
        if (message.type === "MONTHLY_PRICE_BATCH_STATUS") return sendResponse({ ok: true, report: await batchStatus(payload) });
        throw new Error("MONTHLY_PRICE_COMMAND_INVALID");
      } catch (error) { sendResponse({ ok: false, error: String(error?.message || "MONTHLY_PRICE_EXTENSION_FAILED") }); }
    })();
    return true;
  });
})();
