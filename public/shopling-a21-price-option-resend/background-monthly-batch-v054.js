/* global chrome, loadState, saveState, buildBatches, addJobs, baselinePopupTabs, pump, launchJob */
(() => {
  const VERSION = "0.5.4";
  const ORIGIN = "https://commerce-os-ops-center.vercel.app";
  const SHOPLING_SOURCE_URL = "https://a.shopling.co.kr/main.phtml";
  const HISTORY = "commerceOsMonthlyPriceTransmissionHistoryV1";
  const MAX_BATCH_ENTRIES = 5000;
  const MAX_PARALLEL_WINDOWS = 4;
  let batchStartBusy = false;

  const previousAddJobs = addJobs;
  const previousPump = pump;

  const normId = (value) => String(value || "");
  const validUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normId(value));
  const rank = (mode) => mode === "STATUS_SELLING" ? 0 : mode === "PRICE" ? 1 : mode === "OPTION" ? 2 : mode === "STATUS_SOLD_OUT" ? 3 : 99;
  const phaseLabel = (mode) => mode === "STATUS_SELLING" ? "판매중 전환" : mode === "PRICE" ? "판매가" : mode === "OPTION" ? "옵션" : "품절 복구";

  function trusted(sender) {
    try {
      const url = new URL(sender.url);
      return sender.frameId === 0 && url.origin === ORIGIN && url.pathname.startsWith("/china-order-manager");
    } catch {
      return false;
    }
  }

  function makeJob(state, batch, mode) {
    const rollback = mode === "STATUS_SOLD_OUT" && batch.monthlyFailureRollback === true;
    const job = {
      id: `job-${mode.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      batchId: batch.id,
      batchIndex: batch.index,
      mode,
      goodsKeys: [...batch.goodsKeys],
      status: rollback ? "DORMANT" : "QUEUED",
      stage: rollback ? "FAILURE_ROLLBACK_DORMANT" : "OPENING",
      workerWindowId: null,
      workerTabId: null,
      workerFrameId: null,
      popupWindowId: null,
      popupTabId: null,
      popupFrameId: null,
      selectedRowCount: 0,
      totalResultCount: 0,
      message: rollback ? "PRICE/OPTION 실패 시에만 원래 품절상태로 복구" : "대기 중",
      error: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      monthlyScope: true,
      monthlyParallelBatch: true,
      monthlyFailureRollback: rollback,
    };
    state.jobs.push(job);
    return job;
  }

  addJobs = function monthlyBatchAwareAddJobs(state, batch) {
    if (!state?.monthlyBatchId) return previousAddJobs(state, batch);
    const modes = Array.isArray(batch.monthlyModes) && batch.monthlyModes.length ? batch.monthlyModes : ["PRICE", "OPTION"];
    for (const mode of modes) makeJob(state, batch, mode);
  };

  function batchRows(entries) {
    return entries.map((entry) => ({ goodsKey: entry.goodsKey }));
  }

  function decorateBatches(batches, modes, extra = {}) {
    return batches.map((batch) => ({ ...batch, monthlyModes: [...modes], ...extra }));
  }

  function reportItem(state, entry) {
    const jobs = state.jobs.filter((job) => job.monthlyScope && job.goodsKeys?.includes(entry.goodsKey));
    const price = jobs.find((job) => job.mode === "PRICE");
    const option = jobs.find((job) => job.mode === "OPTION");
    const selling = jobs.find((job) => job.mode === "STATUS_SELLING");
    const soldOut = jobs.find((job) => job.mode === "STATUS_SOLD_OUT");
    const terminal = !["RUNNING", "STARTING"].includes(String(state.state));
    const successful =
      price?.status === "SUCCEEDED" &&
      option?.status === "SUCCEEDED" &&
      (!entry.needsSelling || selling?.status === "SUCCEEDED") &&
      (!entry.restoreSoldOut || soldOut?.status === "SUCCEEDED");
    return {
      itemId: entry.itemId,
      token: entry.token,
      fingerprint: entry.fingerprint,
      goodsKey: entry.goodsKey,
      state: terminal ? (successful ? "SUCCEEDED" : "PARTIAL_FAILURE") : "RUNNING",
      priceOnly: price?.status === "SUCCEEDED" && option?.status !== "SUCCEEDED",
      priceAndOption: price?.status === "SUCCEEDED" && option?.status === "SUCCEEDED",
      saleStatusActivated: !entry.needsSelling || selling?.status === "SUCCEEDED",
      saleStatusRestored: !entry.restoreSoldOut || soldOut?.status === "SUCCEEDED",
      saleStatusRolledBack: state.state === "PARTIAL_FAILURE" && entry.needsSelling && soldOut?.status === "SUCCEEDED",
      updatedAt: state.updatedAt,
    };
  }

  function currentPhase(state) {
    const jobs = state.jobs.filter((job) => job.monthlyScope && job.status !== "DORMANT");
    for (const mode of ["STATUS_SELLING", "PRICE", "OPTION", "STATUS_SOLD_OUT"]) {
      const phase = jobs.filter((job) => job.mode === mode);
      if (phase.length && !phase.every((job) => job.status === "SUCCEEDED")) return mode;
    }
    return null;
  }

  function reportBatch(state) {
    return {
      batchId: state.monthlyBatchId,
      state: state.state,
      phase: currentPhase(state),
      goodsKeyCount: state.monthlyBatchEntries?.length || 0,
      maxGoodsKeysPerWindow: 200,
      maxParallelWindows: MAX_PARALLEL_WINDOWS,
      items: (state.monthlyBatchEntries || []).map((entry) => reportItem(state, entry)),
      updatedAt: state.updatedAt,
    };
  }

  async function rememberBatch(state) {
    if (!state?.monthlyBatchId || !Array.isArray(state.monthlyBatchEntries)) return;
    const stored = await chrome.storage.local.get(HISTORY);
    const history = stored[HISTORY] || {};
    const report = reportBatch(state);
    for (const item of report.items) {
      if (!item.token) continue;
      if (history[item.token]?.updatedAt > item.updatedAt) continue;
      history[item.token] = item;
    }
    await chrome.storage.local.set({ [HISTORY]: history });
  }

  function entryTokenSet(entries) {
    return [...entries.map((entry) => String(entry.token || ""))].sort().join(",");
  }

  function sameBatch(state, entries) {
    return Boolean(state?.monthlyBatchId) &&
      entryTokenSet(state.monthlyBatchEntries || []) === entryTokenSet(entries || []);
  }

  async function historyReport(entries) {
    const history = (await chrome.storage.local.get(HISTORY))[HISTORY] || {};
    const rows = entries.map((entry) => history[entry.token]).filter(Boolean);
    if (rows.length !== entries.length) return null;
    if (rows.some((row) => ["RUNNING", "STARTING"].includes(String(row.state)))) {
      throw new Error("MONTHLY_PRICE_TRANSMISSION_HISTORY_MISSING");
    }
    return {
      batchId: "history",
      state: rows.every((row) => row.state === "SUCCEEDED") ? "SUCCEEDED" : "PARTIAL_FAILURE",
      phase: null,
      goodsKeyCount: rows.length,
      maxGoodsKeysPerWindow: 200,
      maxParallelWindows: MAX_PARALLEL_WINDOWS,
      items: rows,
      updatedAt: Math.max(...rows.map((row) => Number(row.updatedAt || 0))),
    };
  }

  async function canonicalBatch(payload) {
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(String(payload.month || "")) || !validUuid(payload.runId)) {
      throw new Error("MONTHLY_PRICE_TRANSMISSION_SCOPE_INVALID");
    }
    const requested = Array.isArray(payload.entries) ? payload.entries : [];
    if (!requested.length || requested.length > MAX_BATCH_ENTRIES) throw new Error("MONTHLY_PRICE_BATCH_SCOPE_INVALID");
    const itemIds = new Set();
    const tokens = new Set();
    for (const entry of requested) {
      if (!validUuid(entry?.itemId) || !validUuid(entry?.token) || !/^[0-9a-f]{64}$/.test(String(entry?.fingerprint || "")) || entry?.newClaim !== true) {
        throw new Error("MONTHLY_PRICE_BATCH_SCOPE_INVALID");
      }
      if (itemIds.has(entry.itemId) || tokens.has(entry.token)) throw new Error("MONTHLY_PRICE_BATCH_SCOPE_CONFLICT");
      itemIds.add(entry.itemId); tokens.add(entry.token);
    }
    const response = await fetch(`${ORIGIN}/api/china-order-manager/monthly-price?month=${payload.month}&runId=${encodeURIComponent(payload.runId)}`, { cache: "no-store", credentials: "omit" });
    const body = await response.json();
    if (!response.ok || !body?.ok || body.run?.id !== payload.runId) throw new Error("MONTHLY_PRICE_SERVER_SCOPE_NOT_VERIFIED");
    const serverItems = new Map((body.items || []).map((row) => [row.id, row]));
    const normalized = requested.map((entry) => {
      const item = serverItems.get(entry.itemId);
      if (
        !item ||
        item.state !== "RESENDING" ||
        item.transmission?.token !== entry.token ||
        item.plan?.fingerprint !== entry.fingerprint ||
        !/^\d{5,9}$/.test(String(item.goodsKey || ""))
      ) throw new Error("MONTHLY_PRICE_SERVER_SCOPE_NOT_VERIFIED");
      return {
        itemId: item.id,
        token: item.transmission.token,
        fingerprint: item.plan.fingerprint,
        goodsKey: String(item.goodsKey),
        needsSelling: item.plan.saleStatusTransition?.target === "B",
        restoreSoldOut: item.plan.saleStatusTransition?.restoreAfterTransmission === true,
      };
    });
    if (new Set(normalized.map((entry) => entry.goodsKey)).size !== normalized.length) {
      throw new Error("MONTHLY_PRICE_BATCH_GOODSKEY_CONFLICT");
    }
    return normalized;
  }

  function phaseJobs(state, mode) {
    return state.jobs.filter((job) => job.monthlyScope && job.mode === mode && job.status !== "DORMANT");
  }

  function hasPrimaryFailure(state) {
    return state.jobs.some((job) => job.monthlyScope && job.monthlyFailureRollback !== true && job.status === "FAILED");
  }

  async function launchPhase(state, mode) {
    const phase = phaseJobs(state, mode);
    const running = phase.filter((job) => job.status === "RUNNING").length;
    const queued = phase.filter((job) => job.status === "QUEUED");
    let slots = Math.max(0, MAX_PARALLEL_WINDOWS - running);
    for (const job of queued) {
      if (slots <= 0) break;
      try {
        await launchJob(state, job);
      } catch (error) {
        job.status = "FAILED";
        job.stage = "FAILED";
        job.error = "MONTHLY_A21_BATCH_WINDOW_CREATE_FAILED";
        job.message = error instanceof Error ? error.message : String(error);
        await saveState(state);
        setTimeout(() => void pump(), 0);
        break;
      }
      slots -= 1;
    }
  }

  async function handleFailure(state) {
    const runningPrimary = state.jobs.filter((job) => job.monthlyScope && job.monthlyFailureRollback !== true && job.status === "RUNNING");
    for (const job of state.jobs) {
      if (!job.monthlyScope || job.mode === "STATUS_SOLD_OUT") continue;
      if (job.status === "QUEUED") {
        job.status = "STOPPED";
        job.stage = "BLOCKED_BY_PRIOR_STAGE";
        job.message = `${phaseLabel(job.mode)} 전 단계 실패로 실행하지 않음`;
      }
    }
    if (runningPrimary.length) {
      await saveState(state);
      return;
    }
    const sellingTouched = state.jobs.some((job) =>
      job.monthlyScope &&
      job.mode === "STATUS_SELLING" &&
      !["QUEUED", "DORMANT"].includes(job.status)
    );
    if (sellingTouched) {
      for (const job of state.jobs) {
        if (job.monthlyScope && job.mode === "STATUS_SOLD_OUT" && job.status === "DORMANT") {
          job.status = "QUEUED";
          job.stage = "FAILURE_ROLLBACK_PENDING";
          job.message = "가격/옵션 전송 실패 · 원래 품절상태로 복구";
        }
      }
      await saveState(state);
      const rollback = phaseJobs(state, "STATUS_SOLD_OUT");
      if (rollback.some((job) => ["QUEUED", "RUNNING"].includes(job.status))) {
        await launchPhase(state, "STATUS_SOLD_OUT");
        return;
      }
    }
    state.state = "PARTIAL_FAILURE";
    await saveState(state);
    await rememberBatch(state);
  }

  pump = async function monthlyBatchParallelPump() {
    const state = await loadState();
    if (!state?.monthlyBatchId) return previousPump();
    if (state.state !== "RUNNING" || state.stopped) return;
    if (hasPrimaryFailure(state)) return handleFailure(state);

    const statusJobs = phaseJobs(state, "STATUS_SELLING");
    if (statusJobs.length && !statusJobs.every((job) => job.status === "SUCCEEDED")) {
      await launchPhase(state, "STATUS_SELLING");
      return;
    }
    const priceJobs = phaseJobs(state, "PRICE");
    if (priceJobs.length && !priceJobs.every((job) => job.status === "SUCCEEDED")) {
      await launchPhase(state, "PRICE");
      return;
    }
    const optionJobs = phaseJobs(state, "OPTION");
    if (optionJobs.length && !optionJobs.every((job) => job.status === "SUCCEEDED")) {
      await launchPhase(state, "OPTION");
      return;
    }
    const restoreJobs = phaseJobs(state, "STATUS_SOLD_OUT").filter((job) => job.monthlyFailureRollback !== true);
    if (restoreJobs.length && !restoreJobs.every((job) => job.status === "SUCCEEDED")) {
      await launchPhase(state, "STATUS_SOLD_OUT");
      return;
    }
    state.state = "SUCCEEDED";
    await saveState(state);
    await rememberBatch(state);
  };

  async function startBatch(payload) {
    if (batchStartBusy) throw new Error("MONTHLY_PRICE_EXTENSION_BUSY");
    batchStartBusy = true;
    try {
      const entries = await canonicalBatch(payload);
      const current = await loadState();
      if (sameBatch(current, entries)) {
        await rememberBatch(current);
        return reportBatch(current);
      }
      if (current?.state === "RUNNING") throw new Error("MONTHLY_PRICE_EXTENSION_BUSY");
      const historical = await historyReport(entries);
      if (historical) return historical;

      const tabs = await chrome.tabs.query({ url: "https://a.shopling.co.kr/*" });
      const source = tabs.find((tab) => /shopling\.co\.kr\//.test(tab.url || "") && !/goods_mallMdfy_trsmt|prodShopInfo/.test(tab.url || ""));
      const sourceUrl = source?.url || SHOPLING_SOURCE_URL;
      const allPriceBatches = decorateBatches(buildBatches(batchRows(entries)), ["PRICE", "OPTION"]);
      const sellingEntries = entries.filter((entry) => entry.needsSelling);
      const sellingBatches = decorateBatches(buildBatches(batchRows(sellingEntries)), ["STATUS_SELLING"]);
      const normalRestoreEntries = sellingEntries.filter((entry) => entry.restoreSoldOut);
      const normalRestoreBatches = decorateBatches(buildBatches(batchRows(normalRestoreEntries)), ["STATUS_SOLD_OUT"], { monthlyFailureRollback: false });
      const failureRollbackEntries = sellingEntries.filter((entry) => !entry.restoreSoldOut);
      const failureRollbackBatches = decorateBatches(buildBatches(batchRows(failureRollbackEntries)), ["STATUS_SOLD_OUT"], { monthlyFailureRollback: true });
      const batches = [...sellingBatches, ...allPriceBatches, ...normalRestoreBatches, ...failureRollbackBatches];
      batches.forEach((batch, index) => { batch.index = index + 1; });

      const state = {
        version: VERSION,
        runId: `monthly-batch-${payload.batchId || Date.now()}`,
        monthlyBatchId: validUuid(payload.batchId) ? payload.batchId : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        monthlyBatchEntries: entries,
        state: "RUNNING",
        testMode: false,
        fingerprint: `monthly-batch-${entries.length}`,
        goodsKeyCount: entries.length,
        fullGoodsKeyCount: entries.length,
        mallCheckCount: 0,
        sourceUrl,
        baselinePopupTabIds: await baselinePopupTabs(),
        batches,
        jobs: [],
        stopped: false,
        startedAt: Date.now(),
        updatedAt: Date.now(),
      };
      for (const batch of batches) addJobs(state, batch);
      await saveState(state);
      await rememberBatch(state);
      await pump();
      return reportBatch(await loadState());
    } finally {
      batchStartBusy = false;
    }
  }

  async function statusBatch(payload) {
    await globalThis.commerceOsWakeA21MonthlyResult?.();
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    const current = await loadState();
    if (sameBatch(current, entries)) {
      await rememberBatch(current);
      return reportBatch(current);
    }
    const historical = await historyReport(entries);
    if (historical) return historical;
    throw new Error("MONTHLY_PRICE_TRANSMISSION_HISTORY_MISSING");
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const next = changes.commerceOsShoplingA21PriceOptionResendV020?.newValue;
    if (next?.monthlyBatchId) void rememberBatch(next);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!["MONTHLY_PRICE_START_BATCH", "MONTHLY_PRICE_STATUS_BATCH"].includes(String(message?.type || ""))) return false;
    if (!trusted(sender)) {
      sendResponse({ ok: false, error: "MONTHLY_PRICE_SENDER_REJECTED" });
      return false;
    }
    void (async () => {
      try {
        const payload = message.payload || {};
        if (message.type === "MONTHLY_PRICE_START_BATCH") return sendResponse({ ok: true, report: await startBatch(payload) });
        if (message.type === "MONTHLY_PRICE_STATUS_BATCH") return sendResponse({ ok: true, report: await statusBatch(payload) });
        return sendResponse({ ok: false, error: "MONTHLY_PRICE_COMMAND_INVALID" });
      } catch (error) {
        return sendResponse({ ok: false, error: String(error?.message || "MONTHLY_PRICE_EXTENSION_FAILED") });
      }
    })();
    return true;
  });
})();