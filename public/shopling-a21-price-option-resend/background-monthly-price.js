/* global chrome, collectMonthlyPricePage, loadState, saveState, publicState,
 buildBatches, addJobs, baselinePopupTabs, pump, startRun */
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
      return true;
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
          job.message = "이전 단계 실패로 후속 전송 중단";
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
      if (phase.every((job) => job.status === "SUCCEEDED")) continue;
      if (phase.some((job) => job.status === "FAILED")) return;
      await launchQueued(state, phase);
      return;
    }
    state.state = "SUCCEEDED";
    await saveState(state);
    await remember(state);
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
  async function readPrices(goodsKey) {
    if (!/^\d{5,9}$/.test(goodsKey)) throw new Error("MONTHLY_PRICE_GOODSKEY_INVALID");
    const url = `https://a.shopling.co.kr/prod/prodShopInfo.phtml?mode=price_chg&prod_id=${goodsKey}`;
    const tab = await chrome.tabs.create({ url, active: false });
    let signature = "", previous = null;
    try {
      for (let attempt = 0; attempt < 35; attempt += 1) {
        await sleep(650);
        const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectMonthlyPricePage, args: [goodsKey] }).catch(() => []);
        const value = results[0]?.result;
        if (!value) continue;
        const next = JSON.stringify(value.rows);
        if (next === signature && previous) return value;
        signature = next; previous = value;
      }
      throw new Error("MONTHLY_PRICE_SHOPLING_LOGIN_OR_DOM_REQUIRED");
    } finally { await chrome.tabs.remove(tab.id).catch(() => null); }
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
        version: "0.5.5",
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
        const scoped = { ...batch, monthlyModes: ["PRICE", "OPTION"] };
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
      const state = { version: "0.5.5", runId: `monthly-${payload.token}`, monthlyToken: payload.token, monthlyGoodsKey: item.goodsKey,
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
        if (message.type === "MONTHLY_PRICE_PING") return sendResponse({ ok: true, version: "0.5.5" });
        if (message.type === "MONTHLY_PRICE_READ") return sendResponse({ ok: true, observation: await readPrices(String(payload.goodsKey || "")) });
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
