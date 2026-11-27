/* Terminal watchers in older workers can finish directly on a processing
 * screen or a mixed marketplace result table. Route both through the same
 * exact-popup advancement used by the normal grouped A21 path. */
(() => {
  const plan = globalThis.shoplingMarketPlanHf102;
  const legacyFinish = finish;
  const legacyContinue = continueNextGoodsKey;
  const legacySave = saveActive;
  const advancing = new Set();
  const scheduled = new Set();
  let saves = Promise.resolve();
  const managed = (active) => active?.job?.stockPlanVersion === 2;

  saveActive = function saveActiveHf102(active) {
    const write = saves.then(async () => {
      if (managed(active)) {
        const latest = await chrome.storage.local.get([STATE_KEY, LAST_RESULT_KEY]);
        const live = latest[STATE_KEY];
        const last = latest[LAST_RESULT_KEY];
        const sameRun = live?.job?.stockPlanOwnerId === active.job.stockPlanOwnerId;
        if (sameRun && (live.stockStateGroupIndexHf72 > active.stockStateGroupIndexHf72 ||
            (live.stockStateGroupIndexHf72 === active.stockStateGroupIndexHf72 && live.goodsKeyIndex > active.goodsKeyIndex))) return live;
        if (live?.status === "RUNNING" && !sameRun) return live;
        const pending = active.stockPlanPendingResult || (live?.job?.jobId === active.job.jobId && live.stockPlanPendingResult);
        if (pending && pending.jobId === active.job.jobId) active.stockPlanPendingResult = pending;
        if (live?.job?.jobId === active.job.jobId && live.lastMileReceiptHf84?.shoplingSubmitInvoked === true) {
          const proof = live.lastMileReceiptHf84;
          // A late list/popup callback may carry a snapshot from just before
          // the native submission. Never replace its proven frame or receipt.
          if (active.lastMileReceiptHf84?.receiptKey !== proof.receiptKey ||
              active.workTabs?.A21_POPUP?.tabId !== proof.popupTabId ||
              active.workTabs?.A21_POPUP?.frameId !== proof.popupFrameId ||
              active.a21PopupOwnershipHf81?.claimedTabId !== proof.popupTabId) {
            Object.assign(active, live);
            if (pending) active.stockPlanPendingResult = pending;
          }
        }
        if (!live && last?.job?.stockPlanOwnerId === active.job.stockPlanOwnerId &&
            last.finishedAt >= active.startedAt) return null;
      }
      const result = await legacySave(active);
      if (active?.stockPlanPendingResult && active.lastMileReceiptHf84?.submitConfirmSeen === true) scheduleReconciliation(active.job.jobId);
      return result;
    });
    saves = write.catch(() => null);
    return write;
  };

  async function reconcile(id) {
    const active = await loadActive();
    const pending = active?.stockPlanPendingResult;
    if (!pending || active.status !== "RUNNING" || active.job.jobId !== id || pending.jobId !== id) return;
    // Only reuse the recorded result observation and the original submit
    // receipt. No list search, popup opening or button click is retried.
    await advance(active, { tab: { id: pending.resultTabId }, frameId: pending.frameId }, pending.observed, false);
  }

  function scheduleReconciliation(id) {
    if (scheduled.has(id)) return;
    scheduled.add(id);
    setTimeout(() => {
      scheduled.delete(id);
      void reconcile(id).catch(() => null);
    }, 200);
  }

  chrome.alarms.onAlarm?.addListener((alarm) => {
    if (alarm?.name !== ALARM_NAME) return;
    void loadActive().then((active) => {
      if (active?.stockPlanPendingResult) return reconcile(active.job.jobId);
    }).catch(() => null);
  });

  async function advance(active, sender, observed, remember = true) {
    const id = active.job.jobId;
    if (advancing.has(id)) return { ok: false, pending: true };
    advancing.add(id);
    try {
      const live = await loadActive();
      if (live?.job?.jobId !== id || live.status !== "RUNNING") return { ok: false, stale: true };
      const resultTabId = sender?.tab?.id;
      const tab = Number.isInteger(resultTabId) ? await chrome.tabs.get(resultTabId).catch(() => null) : null;
      const source = { ...sender, tab: tab || { id: resultTabId } };
      const proof = plan.exactReceipt(live, source, observed);
      if (!proof) {
        const popup = live.workTabs?.A21_POPUP?.tabId;
        if (remember && Number.isInteger(popup) && observed?.exactOwnerA21PopupTabId === popup &&
            (tab?.id === popup || tab?.openerTabId === popup) &&
            (!live.stockPlanPendingResult || plan.advisory(observed))) {
          live.stockPlanPendingResult = { jobId: id, resultTabId, frameId: sender?.frameId ?? 0, observed };
          await saveActive(live);
          scheduleReconciliation(id);
        }
        return { ok: false, pending: true };
      }
      return await legacyContinue(live, source, { ...observed, originalSubmitReceipt: proof });
    } finally {
      advancing.delete(id);
    }
  }

  continueNextGoodsKey = function continueWithExactReceipt(active, sender, evidence) {
    if (!managed(active)) return legacyContinue(active, sender, evidence);
    return advance(active, sender, evidence);
  };

  finish = async function finishHf102(active, outcome, message, evidence = {}) {
    if (!managed(active)) return legacyFinish(active, outcome, message, evidence);
    const live = await loadActive();
    if (live?.job?.jobId !== active.job.jobId) return { outcome: "PENDING", stale: true };
    const currentLeg = active.stockStateGroupIndexHf72;
    const records = evidence.stockStateGroupReceipts;
    if ((outcome === "SUCCEEDED" || outcome === "SUCCESS") && plan.complete(active, records)) {
      const tables = records.map((entry) => entry.evidence).filter(plan.advisory);
      const warnings = tables.reduce((count, row) => count + row.failureCount, 0);
      const totals = tables.reduce((count, row) => count + row.totalCount, 0);
      return legacyFinish(active, "SUCCEEDED", active.job.barcode + " · 예정한 Shopling 전송 " + records.length + "건 모두 접수", {
        ...evidence, code: "SHOPLING_HF102_MARKET_PLAN_ACCEPTED", stockPlanComplete: true,
        responsibilityReceiptAccepted: true, marketFailuresAdvisory: warnings > 0,
        marketFailureCount: warnings, marketTotalCount: totals, marketSuccessCount: totals - warnings,
      });
    }
    const marketWarning = evidence.code === "SHOPLING_HF87_RESULT_TABLE_FAILURE" && plan.advisory(evidence.result);
    if (outcome === "SUCCEEDED" || outcome === "SUCCESS" || marketWarning) {
      const resultTabId = evidence.resultTabId ?? evidence.result?.exactOwnerResultTabId;
      const observed = { ...(evidence.result || {}),
        exactOwnerA21PopupTabId: evidence.result?.exactOwnerA21PopupTabId ?? resultTabId };
      const reply = await advance(active, { tab: { id: resultTabId }, frameId: evidence.resultFrameId ?? 0 }, observed);
      return reply?.result || { outcome: "PENDING", stockPlanLegAccepted: reply?.ok === true && reply?.continuing === true };
    }
    const completed = live.stockStateGroupReceiptsHf72 || [];
    const popupExists = Number.isInteger(live.workTabs?.A21_POPUP?.tabId) ||
      Number.isInteger(live.singlePopupTabId) || Number.isInteger(live.a21PopupOwnershipHf81?.claimedTabId) ||
      live.shoplingDispatchReceiptHf90?.exactOwnerBound === true || live.lastMileReceiptHf84?.shoplingSubmitInvoked === true;
    const uncertain = completed.length > 0 || popupExists;
    return legacyFinish(live, uncertain ? "UNCERTAIN" : outcome, message, {
      ...evidence,
      ...(uncertain ? { code: "SHOPLING_HF102_PARTIAL_OR_UNCERTAIN", failureCode: evidence.code,
        retrySafe: false, browserMutationStarted: true } : {}),
      stockPlanComplete: false, completedStockPlanLegs: completed,
      stoppedGroup: currentLeg, remainingTransmissionGroups: live.job.stockStateTransmissionGroupsHf72.slice(currentLeg),
    });
  };
})();
