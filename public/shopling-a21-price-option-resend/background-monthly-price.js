/* global chrome, collectMonthlyPricePage, loadState, saveState, publicState,
 buildBatches, addJobs, baselinePopupTabs, pump, startRun */
importScripts("background-v044.js", "monthly-price-dom.js");

(() => {
  const ORIGIN = "https://commerce-os-ops-center.vercel.app";
  const HISTORY = "commerceOsMonthlyPriceTransmissionHistoryV1";
  let startBusy = false;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  function trusted(sender) {
    try { return sender.frameId === 0 && new URL(sender.url).origin === ORIGIN && new URL(sender.url).pathname.startsWith("/china-order-manager"); }
    catch { return false; }
  }
  function report(state) {
    const modes = new Set(state.jobs.map((job) => job.mode));
    return { token: state.monthlyToken, fingerprint: state.fingerprint, goodsKey: state.monthlyGoodsKey, state: state.state,
      priceAndOption: state.jobs.length > 0 && modes.has("PRICE") && modes.has("OPTION") && [...modes].every((mode) => ["PRICE", "OPTION"].includes(mode)), updatedAt: state.updatedAt };
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
    legacyAddJobs(state, batch);
    if (state.monthlyToken) state.jobs = state.jobs
      .filter((job) => ["PRICE", "OPTION"].includes(job.mode))
      .map((job) => ({ ...job, monthlyScope: true }));
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
      if (!source) throw new Error("MONTHLY_PRICE_SHOPLING_TAB_REQUIRED");
      if (current?.monthlyToken) await remember(current);
      const batches = buildBatches([{ goodsKey: item.goodsKey }]);
      const state = { version: "0.5.1", runId: `monthly-${payload.token}`, monthlyToken: payload.token, monthlyGoodsKey: item.goodsKey,
        state: "RUNNING", testMode: false, fingerprint: payload.fingerprint, goodsKeyCount: 1, fullGoodsKeyCount: 1,
        mallCheckCount: item.plan.targets.filter((row) => row.mallKey).length, sourceUrl: source.url,
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
    return (await chrome.storage.local.get(HISTORY))[HISTORY]?.[payload.token] || { token: payload.token, fingerprint: payload.fingerprint, goodsKey: payload.goodsKey, state: "MISSING", priceAndOption: true };
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!String(message?.type || "").startsWith("MONTHLY_PRICE_")) return false;
    if (!trusted(sender)) { sendResponse({ ok: false, error: "MONTHLY_PRICE_SENDER_REJECTED" }); return false; }
    void (async () => {
      try {
        const payload = message.payload || {};
        if (message.type === "MONTHLY_PRICE_PING") return sendResponse({ ok: true, version: "0.5.1" });
        if (message.type === "MONTHLY_PRICE_READ") return sendResponse({ ok: true, observation: await readPrices(String(payload.goodsKey || "")) });
        if (message.type === "MONTHLY_PRICE_START") return sendResponse({ ok: true, report: await startMonthly(payload) });
        if (message.type === "MONTHLY_PRICE_STATUS") return sendResponse({ ok: true, report: await status(payload) });
        throw new Error("MONTHLY_PRICE_COMMAND_INVALID");
      } catch (error) { sendResponse({ ok: false, error: String(error?.message || "MONTHLY_PRICE_EXTENSION_FAILED") }); }
    })();
    return true;
  });
})();
