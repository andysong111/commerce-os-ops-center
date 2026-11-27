/* Packaged into the HF102 worker. Each A21 popup owns one direction, one mode
 * and an exact set of goods keys. All option popups precede product popups. */
globalThis.shoplingMarketPlanHf102 = (() => {
  const OPTION = "OPTION_SEND";
  const PRODUCT = "PRODUCT_SALE_STATUS_SEND";
  const statuses = ["ON_SALE", "SOLD_OUT"];

  function groups(job) {
    const keys = job.goodsKeys;
    const keySet = new Set(keys);
    const memberships = new Map();
    const lanes = new Map();
    if (!Array.isArray(keys) || !keys.length || keySet.size !== keys.length ||
        keys.some((key) => typeof key !== "string" || !/^\d+$/.test(key))) {
      throw new Error("SHOPLING_HF102_INVALID_GOODS_KEYS");
    }
    for (const row of job.stockStateTransmissions) {
      const { goodsKey, transmissionKind: kind, effectiveProductKind, desiredStatus, optionCount } = row;
      const option = kind === OPTION;
      if (!keySet.has(goodsKey) || (!option && kind !== PRODUCT) ||
          effectiveProductKind !== (option ? "OPTION" : "SINGLE") ||
          !statuses.includes(desiredStatus) || !Number.isInteger(optionCount) || optionCount < 1 ||
          (option && (optionCount < 2 || job.logicalProductKind !== "OPTION" || desiredStatus !== job.desiredStatus))) {
        throw new Error("SHOPLING_HF102_INVALID_TRANSMISSION_ROW");
      }
      const seen = memberships.get(goodsKey) || new Map();
      if (seen.has(kind) || (seen.size && ![...seen.values()].includes(optionCount))) {
        throw new Error("SHOPLING_HF102_CONFLICTING_TRANSMISSION_ROW");
      }
      seen.set(kind, optionCount);
      memberships.set(goodsKey, seen);
      const lane = kind + ":" + desiredStatus;
      if (!lanes.has(lane)) lanes.set(lane, []);
      lanes.get(lane).push(row);
    }
    if (memberships.size !== keys.length) throw new Error("SHOPLING_HF102_MISSING_GOODS_KEY_STEP");
    const result = [];
    for (const kind of [OPTION, PRODUCT]) {
      for (const desiredStatus of statuses) {
        const rows = lanes.get(kind + ":" + desiredStatus) || [];
        for (let i = 0; i < rows.length; i += 200) {
          const slice = rows.slice(i, i + 200);
          result.push({
            transmissionKind: kind, desiredStatus, effectiveProductKind: slice[0].effectiveProductKind,
            goodsKeys: slice.map((row) => row.goodsKey),
            optionCounts: Object.fromEntries(slice.map((row) => [row.goodsKey, row.optionCount])),
          });
        }
      }
    }
    return result;
  }

  function current(active) {
    const index = active.stockStateGroupIndexHf72;
    return active.job.stockStateTransmissionGroupsHf72[index];
  }

  function prepare(active, group) {
    const job = active.job;
    job.jobId = job.stockPlanOwnerId + "/a21/" + active.stockStateGroupIndexHf72 + "/" + active.goodsKeyIndex;
    job.desiredStatus = group.desiredStatus;
  }

  function clearPreviousPopup(active) {
    for (const field of [
      "lastMileReceiptHf84", "lastMileReceiptHf83", "lastMileReceiptHf82",
      "shoplingDispatchReceiptHf90", "a21PopupOwnershipHf81",
      "shoplingDispatchAcceptedAt", "a21PopupActionStartedAt", "stockPlanPendingResult",
    ]) delete active[field];
  }

  function exactReceipt(active, sender, observed) {
    const job = active.job;
    const group = current(active);
    const r = active.lastMileReceiptHf84;
    const popup = active.workTabs?.A21_POPUP?.tabId;
    const resultTab = sender?.tab?.id;
    if (!r || !group || !Number.isInteger(popup) || popup < 1 ||
        !Number.isInteger(resultTab) || resultTab < 1 ||
        (active.stockStateAcceptedPopupTabIdsHf72 || []).includes(popup)) return null;
    // The legacy A21 recovery path can shorten a batch after native search.
    // Compare exactly the selected slice, not the whole planned group.
    const selected = job.productKind === "OPTION" ? active.optionCurrentBatchKeys : active.singleCurrentBatchKeys;
    if (!Array.isArray(selected) || !selected.length) return null;
    const batchStart = active.goodsKeyIndex;
    const planned = group.goodsKeys.slice(batchStart, batchStart + selected.length);
    const query = planned.join(",");
    const ownerKey = [job.jobId, job.executionId || job.jobId, group.effectiveProductKind, query].join(":");
    const binding = active.a21PopupOwnershipHf81;
    if (selected.join(",") !== query || r.receiptKey !== ownerKey || r.assignmentOwnerKey !== ownerKey ||
        binding?.assignmentOwnerKey !== ownerKey || binding.claimedTabId !== popup || binding.listTabId !== active.workTabs.A21_LIST?.tabId ||
        active.workTabs.A21_POPUP.frameId !== r.popupFrameId || (binding.claimedFrameId != null && binding.claimedFrameId !== r.popupFrameId) ||
        group.desiredStatus !== r.desiredStatus || group.effectiveProductKind !== r.productKind ||
        r.goodsKeyQuery !== query || r.popupTabId !== popup || !Number.isInteger(r.popupFrameId) || r.popupFrameId < 0 ||
        observed?.exactOwnerA21PopupTabId !== popup ||
        (resultTab !== popup && sender?.tab?.openerTabId !== popup) ||
        r.submitDispatchMethod !== "ORIGINAL_SHOPLING_FUNCTION" || r.shoplingSubmitInvoked !== true || r.submitConfirmSeen !== true || r.submitControlVerified !== true ||
        r.targetChecked !== true || r.topChecked !== true) return null;
    return { ...r };
  }

  function advisory(value) {
    const { totalCount: total, successCount: success, failureCount: failure } = value || {};
    return value?.terminal === true && value.resultHeading === true && value.rowsBalanced === true &&
      [total, success, failure].every(Number.isInteger) && total > 0 && failure > 0 && success >= 0 && success + failure === total;
  }

  function complete(active, records) {
    if (!Array.isArray(records) || !records.length) return false;
    const groups = active.job.stockStateTransmissionGroupsHf72;
    let groupIndex = 0;
    let offset = 0;
    const popups = new Set();
    for (const entry of records) {
      const group = groups[groupIndex];
      const proof = entry.evidence?.originalSubmitReceipt;
      const keys = entry.goodsKeys;
      if (!group || !proof || !Array.isArray(keys) || !keys.length ||
          entry.acceptedPopupTabId !== proof.popupTabId || popups.has(proof.popupTabId) ||
          proof.goodsKeyQuery !== keys.join(",") || entry.transmissionKind !== group.transmissionKind ||
          proof.desiredStatus !== group.desiredStatus || proof.productKind !== group.effectiveProductKind ||
          group.goodsKeys.slice(offset, offset + keys.length).join(",") !== keys.join(",")) return false;
      popups.add(proof.popupTabId);
      offset += keys.length;
      if (offset === group.goodsKeys.length) { groupIndex++; offset = 0; }
    }
    return groupIndex === groups.length && offset === 0;
  }

  return { groups, prepare, clearPreviousPopup, current, exactReceipt, advisory, complete };
})();
