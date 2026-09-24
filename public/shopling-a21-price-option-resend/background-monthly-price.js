/* global chrome, collectMonthlyPricePage, loadState, saveState, publicState,
 buildBatches, addJobs, baselinePopupTabs, pump, startRun */
importScripts("background-v044.js", "monthly-price-dom.js");

(() => {
  const ORIGIN = "https://commerce-os-ops-center.vercel.app";
  const SHOPLING_SOURCE_URL = "https://a.shopling.co.kr/main.phtml";
  const HISTORY = "commerceOsMonthlyPriceTransmissionHistoryV1";
  let startBusy = false;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  function trusted(sender) {
    try { return sender.frameId === 0 && new URL(sender.url).origin === ORIGIN && new URL(sender.url).pathname.startsWith("/china-order-manager"); }
    catch { return false; }
  }
  function report(state) {
    const scoped = state.jobs.filter((job) => job.monthlyScope);
    const priceOption = scoped.filter((job) => ["PRICE", "OPTION"].includes(job.mode));
    const activated = scoped.find((job) => job.mode === "STATUS_SELLING");
    const restored = scoped.find((job) => job.mode === "STATUS_SOLD_OUT");
    return { token: state.monthlyToken, fingerprint: state.fingerprint, goodsKey: state.monthlyGoodsKey, state: state.state,
      priceOnly: priceOption.length > 0 && priceOption.every((job) => job.mode === "PRICE"),
      priceAndOption: priceOption.some((job) => job.mode === "PRICE") && priceOption.some((job) => job.mode === "OPTION") && priceOption.every((job) => ["PRICE", "OPTION"].includes(job.mode)),
      saleStatusActivated: !state.monthlyNeedsSellingStatus || activated?.status === "SUCCEEDED",
      saleStatusRestored: !state.monthlyRestoreSoldOut || restored?.status === "SUCCEEDED",
      saleStatusRolledBack: restored?.monthlyFailureRollback === true && restored?.status === "SUCCEEDED",
      updatedAt: state.updatedAt };
  }
  async function remember(state) {
    if (!state?.monthlyToken) return;
    const history = (await chrome.storage.local.get(HISTORY))[HISTORY] || {};
    const value = report(state);
    if (history[value.token]?.updatedAt > value.updatedAt) return;
    history[value.token] = value;
    await chrome.storage.local.set({ [HISTORY]: history });
  }
  const legacyAddJobs = addJobs;
  addJobs = function monthlyScopedJobs(state, batch) {
    const before = state.jobs.length;
    legacyAddJobs(state, batch);
    if (!state.monthlyToken) return;
    const added = state.jobs.splice(before).map((job) => ({ ...job, monthlyScope: true }));
    const price = added.find((job) => job.mode === "PRICE");
    const option = added.find((job) => job.mode === "OPTION");
    const statusJob = (mode) => ({
      ...(price || option),
      id: `job-${mode.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      mode,
      status: "QUEUED",
      stage: "OPENING",
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
      message: "대기 중",
      error: "",
      monthlyScope: true,
    });
    if (state.monthlyNeedsSellingStatus) state.jobs.push(statusJob("STATUS_SELLING"));
    if (price) state.jobs.push(price);
    if (option) state.jobs.push(option);
    if (state.monthlyNeedsSellingStatus) {
      const restore = statusJob("STATUS_SOLD_OUT");
      restore.monthlyFailureRollback = !state.monthlyRestoreSoldOut;
      if (!state.monthlyRestoreSoldOut) {
        restore.status = "DORMANT";
        restore.stage = "FAILURE_ROLLBACK_DORMANT";
        restore.message = "PRICE/OPTION 실패 시에만 원래 품절상태로 안전 복구";
      }
      state.jobs.push(restore);
    }
  };

  const legacyPump = pump;
  pump = async function monthlySerialPump() {
    const state = await loadState();
    if (!state?.monthlyToken) return legacyPump();
    if (state.state !== "RUNNING" || state.stopped) return;
    if (state.jobs.some((job) => job.status === "RUNNING")) return;
    const rank = (mode) => mode === "STATUS_SELLING" ? 0 : mode === "PRICE" ? 1 : mode === "OPTION" ? 2 : mode === "STATUS_SOLD_OUT" ? 3 : 99;
    const scoped = state.jobs.filter((job) => job.monthlyScope).sort((a, b) => rank(a.mode) - rank(b.mode));
    const failed = scoped.find((job) => ["FAILED", "STOPPED"].includes(job.status) && job.monthlyFailureRollback !== true);
    if (failed) {
      const activated = scoped.find((job) => job.mode === "STATUS_SELLING");
      const rollback = scoped.find((job) => job.mode === "STATUS_SOLD_OUT" && job.monthlyFailureRollback === true);
      for (const job of scoped) if (job.status === "QUEUED" && job !== rollback && rank(job.mode) > rank(failed.mode)) {
        job.status = "STOPPED";
        job.stage = "BLOCKED_BY_PRIOR_STAGE";
        job.message = `${job.mode} 전 단계 실패로 송신하지 않음`;
      }
      if (activated?.status === "SUCCEEDED" && rollback?.status === "DORMANT") {
        rollback.status = "QUEUED";
        rollback.stage = "FAILURE_ROLLBACK_PENDING";
        rollback.message = "가격/옵션 전송 실패 · 판매중 노출 방지를 위해 원래 품절상태로 복구";
        await saveState(state);
      }
      if (rollback?.status === "QUEUED") {
        try { await launchJob(state, rollback); }
        catch (error) {
          rollback.status = "FAILED";
          rollback.stage = "FAILURE_ROLLBACK_FAILED";
          rollback.error = "MONTHLY_A21_ROLLBACK_WINDOW_CREATE_FAILED";
          rollback.message = error instanceof Error ? error.message : String(error);
          state.state = "PARTIAL_FAILURE";
          await saveState(state);
        }
        return;
      }
      state.state = "PARTIAL_FAILURE";
      await saveState(state);
      return;
    }
    const next = scoped.find((job) => job.status === "QUEUED" && scoped.filter((prior) => rank(prior.mode) < rank(job.mode) && prior.status !== "DORMANT").every((prior) => prior.status === "SUCCEEDED"));
    if (next) {
      try { await launchJob(state, next); }
      catch (error) {
        next.status = "FAILED";
        next.stage = "FAILED";
        next.error = "MONTHLY_A21_WINDOW_CREATE_FAILED";
        next.message = error instanceof Error ? error.message : String(error);
        await saveState(state);
        await pump();
      }
      return;
    }
    const required = scoped.filter((job) => job.status !== "DORMANT");
    if (required.length && required.every((job) => job.status === "SUCCEEDED")) {
      state.state = "SUCCEEDED";
      await saveState(state);
    }
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
    if (area === "local" && changes.commerceOsShoplingA21PriceOptionResendV020?.newValue?.monthlyToken) void remember(changes.commerceOsShoplingA21PriceOptionResendV020.newValue);
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
      const state = { version: "0.5.4", runId: `monthly-${payload.token}`, monthlyToken: payload.token, monthlyGoodsKey: item.goodsKey,
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
    if (!["MONTHLY_PRICE_PING","MONTHLY_PRICE_READ","MONTHLY_PRICE_START","MONTHLY_PRICE_STATUS"].includes(String(message?.type || ""))) return false;
    if (!trusted(sender)) { sendResponse({ ok: false, error: "MONTHLY_PRICE_SENDER_REJECTED" }); return false; }
    void (async () => {
      try {
        const payload = message.payload || {};
        if (message.type === "MONTHLY_PRICE_PING") return sendResponse({ ok: true, version: "0.5.4" });
        if (message.type === "MONTHLY_PRICE_READ") return sendResponse({ ok: true, observation: await readPrices(String(payload.goodsKey || "")) });
        if (message.type === "MONTHLY_PRICE_START") return sendResponse({ ok: true, report: await startMonthly(payload) });
        if (message.type === "MONTHLY_PRICE_STATUS") return sendResponse({ ok: true, report: await status(payload) });
        throw new Error("MONTHLY_PRICE_COMMAND_INVALID");
      } catch (error) { sendResponse({ ok: false, error: String(error?.message || "MONTHLY_PRICE_EXTENSION_FAILED") }); }
    })();
    return true;
  });
})();

importScripts("background-monthly-batch-v054.js");
