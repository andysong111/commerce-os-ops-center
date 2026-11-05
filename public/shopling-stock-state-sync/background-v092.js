importScripts("background-v091.js");

// HF72 restores the proven comma-separated A21 batch dispatch after the API has
// classified every goods key. OPTION and product-sale-status keys are never
// mixed in one popup; each compatible lane is sent in chunks of at most 200.
(() => {
  const VERSION_V092 = chrome.runtime.getManifest().version;
  const BATCH_MAX_V092 = 200;
  const RESULT_MATCH_V092 = [
    "https://shopling.co.kr/prod_a/prod_status_trsmt.phtml*",
    "https://*.shopling.co.kr/prod_a/prod_status_trsmt.phtml*",
  ];
  const legacyStartV092 = start;
  const legacyDispatchToTargetV092 = dispatchToTarget;
  const legacyDispatchCurrentV092 = dispatchCurrent;
  const legacyContinueNextGoodsKeyV092 = continueNextGoodsKey;

  function normalizePlanV092(input) {
    const job = input && typeof input === "object" ? { ...input } : {};
    const jobId = norm(job.jobId);
    const barcode = norm(job.barcode).toUpperCase().replace(/\s+/g, "");
    const desiredStatus = norm(job.desiredStatus).toUpperCase();
    const logicalProductKind = norm(job.logicalProductKind || job.productKind).toUpperCase();
    const goodsKeys = Array.isArray(job.goodsKeys) ? job.goodsKeys.map(norm) : [];
    const rows = Array.isArray(job.stockStateTransmissions)
      ? job.stockStateTransmissions
      : [];
    const receipts = Array.isArray(job.stockStateApiEvidence)
      ? job.stockStateApiEvidence
      : [];
    if (!jobId) return { ok: false, code: "STOCK_SYNC_JOB_ID_REQUIRED", message: "작업 ID가 없습니다." };
    if (!/^B[A-Z]{1,2}\d+-\d+$/.test(barcode)) return { ok: false, code: "STOCK_SYNC_BARCODE_INVALID", message: "B코드 형식이 올바르지 않습니다." };
    if (!["OPTION", "SINGLE"].includes(logicalProductKind)) return { ok: false, code: "STOCK_SYNC_PRODUCT_KIND_INVALID", message: "상품형태가 올바르지 않습니다." };
    if (!["SOLD_OUT", "ON_SALE"].includes(desiredStatus)) return { ok: false, code: "STOCK_SYNC_DESIRED_STATUS_INVALID", message: "목표상태가 올바르지 않습니다." };
    if (!goodsKeys.length || rows.length !== goodsKeys.length || receipts.length !== goodsKeys.length) {
      return { ok: false, code: "SHOPLING_HF72_API_PLAN_COUNT_MISMATCH", message: "API 검증 goods key·전송계획·영수증 수가 일치하지 않습니다." };
    }

    const goodsKeySet = new Set();
    const normalizedRows = [];
    for (const row of rows) {
      const goodsKey = norm(row?.goodsKey);
      const transmissionKind = norm(row?.transmissionKind).toUpperCase();
      const effectiveProductKind = transmissionKind === "OPTION_SEND"
        ? "OPTION"
        : transmissionKind === "PRODUCT_SALE_STATUS_SEND"
          ? "SINGLE"
          : "";
      const declaredProductKind = norm(row?.effectiveProductKind).toUpperCase();
      const optionCount = Number(row?.optionCount || 0);
      if (!/^\d+$/.test(goodsKey) || goodsKeySet.has(goodsKey) || !effectiveProductKind || declaredProductKind !== effectiveProductKind || !Number.isInteger(optionCount) || optionCount < 1) {
        return { ok: false, code: "SHOPLING_HF72_API_PLAN_INVALID", message: `goods key ${goodsKey || "미확인"}의 API 전송계획이 유효하지 않습니다.` };
      }
      goodsKeySet.add(goodsKey);
      normalizedRows.push({ ...row, goodsKey, transmissionKind, effectiveProductKind, optionCount });
    }
    if (new Set(goodsKeys).size !== goodsKeys.length || goodsKeys.some((goodsKey) => !goodsKeySet.has(goodsKey))) {
      return { ok: false, code: "SHOPLING_HF72_GOODS_KEY_SET_MISMATCH", message: "API 검증 goods key 집합과 전송계획이 일치하지 않습니다." };
    }
    const receiptKeys = new Set(receipts.map((row) => norm(row?.matchedGoodsKey)));
    if (receiptKeys.size !== goodsKeys.length || goodsKeys.some((goodsKey) => !receiptKeys.has(goodsKey))) {
      return { ok: false, code: "SHOPLING_HF72_RECEIPT_SET_MISMATCH", message: "API 재조회 영수증과 전송 대상 goods key가 일치하지 않습니다." };
    }

    const groups = ["OPTION_SEND", "PRODUCT_SALE_STATUS_SEND"]
      .map((transmissionKind) => {
        const groupRows = normalizedRows.filter((row) => row.transmissionKind === transmissionKind);
        if (!groupRows.length) return null;
        return {
          transmissionKind,
          effectiveProductKind: transmissionKind === "OPTION_SEND" ? "OPTION" : "SINGLE",
          goodsKeys: groupRows.map((row) => row.goodsKey),
          optionCounts: Object.fromEntries(groupRows.map((row) => [row.goodsKey, row.optionCount])),
        };
      })
      .filter(Boolean);
    if (!groups.length) {
      return { ok: false, code: "SHOPLING_HF72_GROUP_EMPTY", message: "Shopling 전송 묶음을 만들지 못했습니다." };
    }

    delete job.stockStateTransmissions;
    const firstGroup = groups[0];
    return {
      ok: true,
      job: {
        ...job,
        jobId,
        barcode,
        desiredStatus,
        logicalProductKind,
        productKind: firstGroup.effectiveProductKind,
        goodsKeys: [...firstGroup.goodsKeys],
        stockStateApiApplied: true,
        optionApiApplied: firstGroup.effectiveProductKind === "OPTION",
        productStatusApiApplied: firstGroup.effectiveProductKind === "SINGLE",
        stockStateAllGoodsKeysHf72: [...goodsKeys],
        stockStateTransmissionPlanHf72: normalizedRows,
        stockStateTransmissionGroupsHf72: groups,
        stockStateApiEvidenceAllHf72: receipts,
        stockStateBatchMaxHf72: BATCH_MAX_V092,
      },
      groups,
    };
  }

  function isGroupedJobV092(active) {
    return Boolean(
      active?.job?.stockStateApiApplied === true &&
      Array.isArray(active?.job?.stockStateTransmissionGroupsHf72) &&
      active.job.stockStateTransmissionGroupsHf72.length > 0,
    );
  }

  function currentGroupV092(active) {
    const groups = active?.job?.stockStateTransmissionGroupsHf72;
    const index = Math.max(0, Number(active?.stockStateGroupIndexHf72 || 0));
    return Array.isArray(groups) ? groups[index] || null : null;
  }

  function prepareCurrentGroupV092(active) {
    const group = currentGroupV092(active);
    if (!group || !Array.isArray(group.goodsKeys) || !group.goodsKeys.length) return false;
    const groupIndex = Math.max(0, Number(active?.stockStateGroupIndexHf72 || 0));
    const groupChanged = Number(active?.stockStatePreparedGroupIndexHf72) !== groupIndex;
    active.job.productKind = group.effectiveProductKind;
    active.job.goodsKeys = [...group.goodsKeys];
    active.job.currentTransmissionKind = group.transmissionKind;
    active.job.optionApiApplied = group.effectiveProductKind === "OPTION";
    active.job.productStatusApiApplied = group.effectiveProductKind === "SINGLE";
    active.job.currentGoodsOptionCount = Number(group.optionCounts?.[currentGoodsKey(active)] || 0);
    if (groupChanged) {
      active.optionBatchLimit = BATCH_MAX_V092;
      active.singleBatchLimit = BATCH_MAX_V092;
      active.stockStatePreparedGroupIndexHf72 = groupIndex;
    }
    return Number(active.goodsKeyIndex || 0) < group.goodsKeys.length;
  }

  function resetForNextBatchV092(active) {
    active.stage = "A21_LIST";
    active.stageStartedAt = Date.now();
    active.attempts = {};
    active.a21CanonicalStage = null;
    active.a21CanonicalStageAt = 0;
    active.singleA21CanonicalStage = null;
    active.singleA21CanonicalStageAt = 0;
    active.optionCurrentBatchKeys = [];
    active.singleCurrentBatchKeys = [];
    active.optionCurrentBatchStart = Number(active.goodsKeyIndex || 0);
    active.singleCurrentBatchStart = Number(active.goodsKeyIndex || 0);
    active.a21PopupBaselineTabIds = [];
    active.singleA21PopupBaselineTabIds = [];
    active.singlePopupTabId = null;
    active.singlePopupWindowId = null;
    active.shoplingDispatchResultTabId = null;
    active.shoplingDispatchResultWindowId = null;
    active.shoplingDispatchResultUrl = "";
    active.shoplingResultBaselineBatchKeyHf72 = "";
    active.shoplingResultBaselineTabIdsHf72 = [];
    active.workTabs = { A21_LIST: active.workTabs?.A21_LIST };
    active.shoplingTabId = active.workTabs?.A21_LIST?.tabId || null;
    active.shoplingFrameId = active.workTabs?.A21_LIST?.frameId || null;
  }

  async function ensureResultBaselineV092(active) {
    const batchKey = `${Number(active?.stockStateGroupIndexHf72 || 0)}:${Number(active?.goodsKeyIndex || 0)}`;
    if (active?.shoplingResultBaselineBatchKeyHf72 === batchKey) return;
    const resultTabs = await chrome.tabs
      .query({ url: RESULT_MATCH_V092 })
      .catch(() => []);
    active.shoplingResultBaselineBatchKeyHf72 = batchKey;
    active.shoplingResultBaselineTabIdsHf72 = resultTabs
      .map((tab) => Number(tab?.id))
      .filter(Number.isInteger);
  }

  function currentBatchV092(active) {
    const option = String(active?.job?.productKind || "").toUpperCase() === "OPTION";
    const saved = option ? active?.optionCurrentBatchKeys : active?.singleCurrentBatchKeys;
    if (Array.isArray(saved) && saved.length) return [...saved];
    const start = Math.max(0, Number(active?.goodsKeyIndex || 0));
    const configuredLimit = Number(option ? active?.optionBatchLimit : active?.singleBatchLimit);
    const limit = Math.max(1, Math.min(BATCH_MAX_V092, Number.isFinite(configuredLimit) ? configuredLimit : BATCH_MAX_V092));
    return Array.isArray(active?.job?.goodsKeys)
      ? active.job.goodsKeys.slice(start, start + limit)
      : [];
  }

  start = async function startV092(input) {
    if (input?.stockStateApiApplied !== true || !input?.stockStateTransmissions) {
      return legacyStartV092(input);
    }
    const normalized = normalizePlanV092(input);
    if (!normalized.ok) return normalized;
    const existing = await loadActive();
    if (existing?.status === "RUNNING") {
      return { ok: false, code: "STOCK_SYNC_ALREADY_RUNNING", message: `이미 ${existing.job?.barcode || "다른 B코드"} Shopling 작업이 실행 중입니다.`, active: existing };
    }
    const target = await findExactRoleTarget("A21_LIST");
    if (!target) {
      return { ok: false, code: "SHOPLING_A21_TAB_MISSING", message: "로그인된 Shopling A21 쇼핑몰상품수정 탭을 열어 주세요.", missing: ["A21 쇼핑몰상품수정"] };
    }
    const now = Date.now();
    const active = {
      status: "RUNNING",
      job: normalized.job,
      stage: "A21_LIST",
      stageStartedAt: now,
      startedAt: now,
      updatedAt: now,
      shoplingTabId: target.tabId,
      shoplingFrameId: target.frameId,
      workTabs: { A21_LIST: { tabId: target.tabId, frameId: target.frameId } },
      goodsKeyIndex: 0,
      stockStateGroupIndexHf72: 0,
      stockStateGroupReceiptsHf72: [],
      optionBatchLimit: BATCH_MAX_V092,
      singleBatchLimit: BATCH_MAX_V092,
      attempts: {},
      evidence: [],
      message: `${normalized.job.barcode} API 상태·수량 검증 완료 · goods key ${normalized.job.stockStateAllGoodsKeysHf72.length}건을 ${normalized.groups.length}개 호환 묶음으로 A21 전송 준비`,
      extensionVersion: VERSION_V092,
    };
    prepareCurrentGroupV092(active);
    await saveActive(active);
    await chrome.alarms.create(ALARM_NAME, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
    await progress(active, active.message, {
      apiOnlyPreflight: true,
      browserStagesSkipped: ["A4", "A6"],
      goodsKeyBatching: "GROUP_BY_TRANSMISSION_KIND_UP_TO_200",
      transmissionGroups: normalized.groups.map((group) => ({
        transmissionKind: group.transmissionKind,
        goodsKeyCount: group.goodsKeys.length,
        batchCount: Math.ceil(group.goodsKeys.length / BATCH_MAX_V092),
      })),
      stockStateApiEvidence: active.job.stockStateApiEvidenceAllHf72,
      extensionVersion: VERSION_V092,
    });
    const dispatched = await dispatchCurrent(active, { focus: true });
    if (!dispatched) {
      const result = await finish(active, "FAILED", "API 검증은 완료됐지만 첫 A21 goods key 묶음을 작업창에 전달하지 못했습니다.", {
        code: "SHOPLING_HF72_FIRST_GROUP_DISPATCH_FAILED",
        retrySafe: true,
      });
      return { ok: false, code: "SHOPLING_HF72_FIRST_GROUP_DISPATCH_FAILED", message: result.message, result };
    }
    return { ok: true, active: await loadActive(), message: active.message };
  };

  dispatchToTarget = async function dispatchToTargetV092(active, target) {
    if (!isGroupedJobV092(active)) return legacyDispatchToTargetV092(active, target);
    if (!prepareCurrentGroupV092(active)) return false;
    await ensureResultBaselineV092(active);
    await saveActive(active);
    return legacyDispatchToTargetV092(active, target);
  };

  dispatchCurrent = async function dispatchCurrentV092(active, options = {}) {
    if (!isGroupedJobV092(active)) return legacyDispatchCurrentV092(active, options);
    if (!prepareCurrentGroupV092(active)) return false;
    await ensureResultBaselineV092(active);
    await saveActive(active);
    const group = currentGroupV092(active);
    const configuredLimit = Number(group.effectiveProductKind === "OPTION" ? active.optionBatchLimit : active.singleBatchLimit);
    const batchLimit = Math.max(1, Math.min(BATCH_MAX_V092, Number.isFinite(configuredLimit) ? configuredLimit : BATCH_MAX_V092));
    await progress(active, `${active.job.barcode} · ${group.effectiveProductKind === "OPTION" ? "옵션송신" : "상품판매상태송신"} goods key ${group.goodsKeys.length}건 중 ${Number(active.goodsKeyIndex || 0) + 1}번째부터 최대 ${batchLimit}건 일괄검색`, {
      transmissionKind: group.transmissionKind,
      groupIndex: Number(active.stockStateGroupIndexHf72 || 0),
      groupCount: active.job.stockStateTransmissionGroupsHf72.length,
      groupedGoodsKeyDispatch: true,
      batchLimit,
      extensionVersion: VERSION_V092,
    });
    return legacyDispatchCurrentV092(active, options);
  };

  continueNextGoodsKey = async function continueNextGoodsKeyV092(active, sender, evidence) {
    if (!isGroupedJobV092(active)) {
      return legacyContinueNextGoodsKeyV092(active, sender, evidence);
    }
    const group = currentGroupV092(active);
    const batch = currentBatchV092(active);
    const batchStart = Math.max(0, Number(active.goodsKeyIndex || 0));
    if (!group || !batch.length || batchStart + batch.length > group.goodsKeys.length) {
      return {
        ok: false,
        result: await finish(active, "FAILED", "Shopling 처리화면은 확인했지만 현재 goods key 묶음 범위를 검증하지 못했습니다.", {
          code: "SHOPLING_HF72_COMPLETED_BATCH_RANGE_INVALID",
          batch,
          batchStart,
          group,
        }),
      };
    }
    active.stockStateGroupReceiptsHf72 = [
      ...(Array.isArray(active.stockStateGroupReceiptsHf72) ? active.stockStateGroupReceiptsHf72 : []),
      {
        transmissionKind: group.transmissionKind,
        goodsKeys: batch,
        acceptedAt: Date.now(),
        evidence,
      },
    ];
    const nextStart = batchStart + batch.length;
    if (nextStart < group.goodsKeys.length) {
      active.goodsKeyIndex = nextStart;
      resetForNextBatchV092(active);
      await saveActive(active);
      const configuredLimit = Number(group.effectiveProductKind === "OPTION" ? active.optionBatchLimit : active.singleBatchLimit);
      const batchLimit = Math.max(1, Math.min(BATCH_MAX_V092, Number.isFinite(configuredLimit) ? configuredLimit : BATCH_MAX_V092));
      await progress(active, `${active.job.barcode} · ${group.transmissionKind} ${batch.length}건 전송 접수 확인 → 같은 묶음 다음 ${Math.min(batchLimit, group.goodsKeys.length - nextStart)}건 계속`, {
        completedBatchKeys: batch,
        nextStart,
        groupGoodsKeyCount: group.goodsKeys.length,
        batchLimit,
        commerceOsBoundary: "A21_PROCESSING_OR_RESULT_SCREEN_STARTED",
      });
      await sleep(350);
      const dispatched = await dispatchCurrent(active, { focus: true });
      if (dispatched) return { ok: true, continuing: true, nextStart };
      return {
        ok: false,
        result: await finish(active, "FAILED", "다음 goods key 묶음을 A21 작업창에 전달하지 못했습니다.", {
          code: "SHOPLING_HF72_NEXT_BATCH_DISPATCH_FAILED",
          retrySafe: true,
          completedBatchKeys: batch,
        }),
      };
    }

    const nextGroupIndex = Number(active.stockStateGroupIndexHf72 || 0) + 1;
    if (nextGroupIndex < active.job.stockStateTransmissionGroupsHf72.length) {
      active.stockStateGroupIndexHf72 = nextGroupIndex;
      active.goodsKeyIndex = 0;
      const nextGroup = active.job.stockStateTransmissionGroupsHf72[nextGroupIndex];
      active.job.goodsKeys = [...nextGroup.goodsKeys];
      resetForNextBatchV092(active);
      prepareCurrentGroupV092(active);
      await saveActive(active);
      await progress(active, `${active.job.barcode} · ${group.transmissionKind} goods key ${group.goodsKeys.length}건 전송 접수 완료 → ${nextGroup.transmissionKind} goods key ${nextGroup.goodsKeys.length}건 일괄전송 시작`, {
        completedGroup: group.transmissionKind,
        nextGroup: nextGroup.transmissionKind,
        commerceOsBoundary: "A21_PROCESSING_OR_RESULT_SCREEN_STARTED",
      });
      await sleep(350);
      const dispatched = await dispatchCurrent(active, { focus: true });
      if (dispatched) return { ok: true, continuing: true, nextGroupIndex };
      return {
        ok: false,
        result: await finish(active, "FAILED", "다음 전송 종류의 goods key 묶음을 A21 작업창에 전달하지 못했습니다.", {
          code: "SHOPLING_HF72_NEXT_GROUP_DISPATCH_FAILED",
          retrySafe: true,
          nextGroup: nextGroup.transmissionKind,
        }),
      };
    }

    const allGoodsKeys = active.job.stockStateAllGoodsKeysHf72;
    return {
      ok: true,
      result: await finish(active, "SUCCEEDED", `${active.job.barcode} Shopling 전송 접수 완료 · goods key ${allGoodsKeys.length}건을 호환 종류별 일괄전송`, {
        result: evidence,
        resultTabId: sender?.tab?.id,
        resultFrameId: sender?.frameId,
        stockStateApiEvidence: active.job.stockStateApiEvidenceAllHf72,
        stockStateGroupReceipts: active.stockStateGroupReceiptsHf72,
        goodsKeyCount: allGoodsKeys.length,
        groupCount: active.job.stockStateTransmissionGroupsHf72.length,
        goodsKeyBatching: "GROUP_BY_TRANSMISSION_KIND_UP_TO_200",
        commerceOsBoundary: "A21_PROCESSING_OR_RESULT_SCREEN_STARTED",
        marketplaceCompletionRequired: false,
      }),
    };
  };

  console.log(
    "[CommerceOS Stock HF72]",
    new Date().toISOString(),
    "API-classified goods keys grouped by compatible A21 transmission up to 200",
    VERSION_V092,
  );
})();
