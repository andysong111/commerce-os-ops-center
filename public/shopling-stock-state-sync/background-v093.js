importScripts("background-v092.js");

// HF74 closes two gaps left in HF72:
// 1. The grouped plan was passed back through the old canonical adapters, which
//    reduced every A21 assignment to one goods key.
// 2. The list worker clicked the red action in the isolated extension world.
//
// Keep the API-classified OPTION/SINGLE groups separate, but send every goods
// key in the current compatible chunk (up to 200) to the canonical A21 worker.
(() => {
  const VERSION_V093 = chrome.runtime.getManifest().version;
  const CANONICAL_LIST_SCRIPT_V093 = "content-a21-canonical-v015.js";
  const CANONICAL_IDENTIFY_V093 = "A21_IDENTIFY";
  const CANONICAL_ASSIGN_V093 = "A21_LIST_ASSIGNMENT";
  const BATCH_MAX_V093 = 200;
  const legacyDispatchCurrentV093 = dispatchCurrent;
  const legacyDispatchToTargetV093 = dispatchToTarget;

  function groupedJobV093(active) {
    return Boolean(
      active?.status === "RUNNING" &&
      active?.stage === "A21_LIST" &&
      active?.job?.stockStateApiApplied === true &&
      Array.isArray(active?.job?.stockStateTransmissionGroupsHf72) &&
      active.job.stockStateTransmissionGroupsHf72.length > 0,
    );
  }

  function currentGroupV093(active) {
    const groups = active?.job?.stockStateTransmissionGroupsHf72;
    const index = Math.max(0, Number(active?.stockStateGroupIndexHf72 || 0));
    return Array.isArray(groups) ? groups[index] || null : null;
  }

  function currentBatchV093(active, group) {
    if (!group || !Array.isArray(group.goodsKeys)) return [];
    const start = Math.max(0, Number(active?.goodsKeyIndex || 0));
    const configured = Number(
      group.effectiveProductKind === "OPTION"
        ? active?.optionBatchLimit
        : active?.singleBatchLimit,
    );
    const limit = Math.max(
      1,
      Math.min(
        BATCH_MAX_V093,
        Number.isFinite(configured) ? configured : BATCH_MAX_V093,
      ),
    );
    return group.goodsKeys.slice(start, start + limit).map(norm).filter(Boolean);
  }

  function prepareGroupedBatchV093(active) {
    const group = currentGroupV093(active);
    const batch = currentBatchV093(active, group);
    if (!group || !batch.length) return null;
    active.job.productKind = group.effectiveProductKind;
    active.job.goodsKeys = [...group.goodsKeys];
    active.job.currentTransmissionKind = group.transmissionKind;
    active.job.optionApiApplied = group.effectiveProductKind === "OPTION";
    active.job.productStatusApiApplied = group.effectiveProductKind === "SINGLE";
    active.job.currentGoodsOptionCount = Number(group.optionCounts?.[batch[0]] || 0);
    if (group.effectiveProductKind === "OPTION") {
      active.optionCurrentBatchKeys = [...batch];
      active.singleCurrentBatchKeys = [];
    } else {
      active.singleCurrentBatchKeys = [...batch];
      active.optionCurrentBatchKeys = [];
    }
    return { group, batch };
  }

  function runIdV093(active) {
    return String(active?.job?.executionId || active?.job?.jobId || "");
  }

  function canonicalStageV093(active, group) {
    if (group.effectiveProductKind === "OPTION") {
      return String(
        active?.a21CanonicalStage ||
        `LIST_START_${Number(active?.stockStateGroupIndexHf72 || 0)}_${Number(active?.goodsKeyIndex || 0)}_${runIdV093(active)}`,
      );
    }
    return String(
      active?.singleA21CanonicalStage ||
      `SINGLE_LIST_START_${Number(active?.stockStateGroupIndexHf72 || 0)}_${Number(active?.goodsKeyIndex || 0)}_${runIdV093(active)}`,
    );
  }

  function canonicalAssignmentV093(active, group, batch) {
    return {
      type: CANONICAL_ASSIGN_V093,
      jobId: active.job.jobId,
      // OPTION is the canonical list transport mode for both popup types.
      // The claimed popup is configured by the stock OPTION/SINGLE worker.
      mode: "OPTION",
      goodsKeys: [...batch],
      stage: canonicalStageV093(active, group),
      runId: runIdV093(active),
      version: VERSION_V093,
    };
  }

  async function ensureCanonicalListWorkerV093(target) {
    if (!target || !Number.isInteger(target.tabId) || !Number.isInteger(target.frameId)) {
      return false;
    }
    const options = { frameId: target.frameId };
    let probe = await chrome.tabs.sendMessage(
      target.tabId,
      { type: CANONICAL_IDENTIFY_V093 },
      options,
    ).catch(() => null);
    if (probe?.ok && probe.role === "A21_LIST") return true;
    await chrome.scripting.executeScript({
      target: { tabId: target.tabId, frameIds: [target.frameId] },
      files: [CANONICAL_LIST_SCRIPT_V093],
    }).catch(() => null);
    await sleep(140);
    probe = await chrome.tabs.sendMessage(
      target.tabId,
      { type: CANONICAL_IDENTIFY_V093 },
      options,
    ).catch(() => null);
    return Boolean(probe?.ok && probe.role === "A21_LIST");
  }

  async function dispatchGroupedListV093(active, target, { focus = false } = {}) {
    if (!groupedJobV093(active) || !target) return false;
    const prepared = prepareGroupedBatchV093(active);
    if (!prepared) return false;
    const { group, batch } = prepared;

    if (focus) {
      await chrome.tabs.update(target.tabId, { active: true }).catch(() => null);
      if (Number.isInteger(target.windowId)) {
        await chrome.windows.update(target.windowId, { focused: true }).catch(() => null);
      }
    }
    if (!(await ensureCanonicalListWorkerV093(target))) {
      await progress(active, `${active.job.barcode} · A21 일괄 목록 작업기 연결 대기`, {
        code: "SHOPLING_HF74_GROUPED_LIST_WORKER_NOT_READY",
        goodsKeys: batch,
        target,
      });
      return false;
    }

    active.shoplingTabId = target.tabId;
    active.shoplingFrameId = target.frameId;
    active.workTabs = {
      ...(active.workTabs || {}),
      A21_LIST: { tabId: target.tabId, frameId: target.frameId },
    };
    await saveActive(active);

    const assignment = canonicalAssignmentV093(active, group, batch);
    const response = await chrome.tabs.sendMessage(
      target.tabId,
      assignment,
      { frameId: target.frameId },
    ).catch(() => null);

    if (response?.ok && response?.accepted) {
      await progress(
        active,
        `${active.job.barcode} · ${group.effectiveProductKind === "OPTION" ? "옵션송신" : "상품판매상태송신"} goods key ${batch.length}건을 한 번에 A21 전달`,
        {
          transmissionKind: group.transmissionKind,
          groupedGoodsKeys: batch,
          groupedGoodsKeyCount: batch.length,
          groupedAssignmentStage: assignment.stage,
          serialPerGoodsKey: false,
          extensionVersion: VERSION_V093,
        },
      );
      return true;
    }
    return false;
  }

  if (globalThis.__COMMERCE_OS_EXPOSE_STOCK_HF74_TEST_HOOKS__ === true) {
    globalThis.__commerceOsStockHf74TestHooks = {
      currentBatchV093,
      prepareGroupedBatchV093,
      canonicalStageV093,
      canonicalAssignmentV093,
    };
    return;
  }

  dispatchToTarget = async function dispatchToTargetV093(active, target) {
    if (groupedJobV093(active)) return dispatchGroupedListV093(active, target);
    return legacyDispatchToTargetV093(active, target);
  };

  dispatchCurrent = async function dispatchCurrentV093(active, options = {}) {
    if (!groupedJobV093(active)) return legacyDispatchCurrentV093(active, options);
    const target = await findExactRoleTarget("A21_LIST");
    if (!target) return false;
    return dispatchGroupedListV093(active, target, options);
  };

  console.log(
    "[CommerceOS Stock HF74]",
    new Date().toISOString(),
    "compatible goods keys assigned once per A21 batch; list action uses main-world click bridge",
    VERSION_V093,
  );
})();
