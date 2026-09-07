importScripts("background-v050.js");

// v0.5.4 OPTION flow:
// A6 is read-only and only discovers every live goods key for the B-code.
// Commerce OS then applies the option status through the proven Shopling API once per
// discovered goods key, and A21 serially transmits every goods key before completion.
(() => {
  const VERSION_V052 = chrome.runtime.getManifest().version;
  const APPLY_OPTION_STATUS_V054 = "STOCK_SYNC_APPLY_OPTION_STATUS_V054";
  const legacyValidJobV052 = validJob;
  const legacyHandleStepResultV052 = handleStepResult;

  validJob = function validJobV052(input) {
    const kind = norm(input?.productKind).toUpperCase();
    if (kind !== "OPTION") return legacyValidJobV052(input);

    const jobId = norm(input?.jobId);
    const barcode = norm(input?.barcode).toUpperCase().replace(/\s+/g, "");
    const desiredStatus = norm(input?.desiredStatus).toUpperCase();
    const modelNo = norm(input?.modelNo) || null;
    if (!jobId) return { ok: false, code: "STOCK_SYNC_JOB_ID_REQUIRED", message: "작업 ID가 없습니다." };
    if (!/^B[A-Z]{1,2}\d+-\d+$/.test(barcode)) {
      return { ok: false, code: "STOCK_SYNC_BARCODE_INVALID", message: "B코드 형식이 올바르지 않습니다." };
    }
    if (!["SOLD_OUT", "ON_SALE"].includes(desiredStatus)) {
      return { ok: false, code: "STOCK_SYNC_DESIRED_STATUS_INVALID", message: "목표상태는 품절 또는 판매중이어야 합니다." };
    }
    const initialGoodsKeys = Array.isArray(input?.goodsKeys)
      ? [...new Set(input.goodsKeys.map((value) => norm(value)).filter((value) => /^\d+$/.test(value)))]
      : [];
    return {
      ok: true,
      job: {
        ...input,
        jobId,
        barcode,
        productKind: "OPTION",
        desiredStatus,
        modelNo,
        initialGoodsKeys,
        goodsKeys: [],
        optionApiApplied: false,
        goodsKeySource: "A6_LIVE_OPTION_BARCODE",
      },
    };
  };

  requiredStages = function requiredStagesV052(productKind) {
    return productKind === "OPTION" ? ["A6", "A21_LIST"] : ["A4", "A21_LIST"];
  };

  async function applyOptionStatusViaOpsV054(active) {
    const tabs = await chrome.tabs.query({ url: OPS_MATCH }).catch(() => []);
    const candidates = tabs
      .filter((tab) => Number.isInteger(tab?.id))
      .sort((left, right) => Number(Boolean(right.active)) - Number(Boolean(left.active)) || Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0));
    let lastFailure = null;
    for (const tab of candidates) {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: APPLY_OPTION_STATUS_V054,
        job: {
          ...active.job,
          goodsKeys: [...active.job.goodsKeys],
        },
        version: VERSION_V052,
      }).catch(() => null);
      if (response?.ok) return response;
      if (response) lastFailure = response;
    }
    return lastFailure || {
      ok: false,
      code: "SHOPLING_OPTION_API_BRIDGE_NOT_FOUND",
      message: "Commerce OS 탭의 옵션상태 API bridge에 연결하지 못했습니다. 페이지를 새로고침한 뒤 다시 시도하세요.",
      results: [],
    };
  }

  start = async function startV052(input) {
    const normalized = validJob(input);
    if (!normalized.ok) return normalized;
    if (normalized.job.productKind !== "OPTION") {
      const legacyInput = { ...input, productKind: "SINGLE" };
      return (await legacyValidJobV052(legacyInput)).ok === false
        ? legacyValidJobV052(legacyInput)
        : startSingleV052(legacyInput);
    }

    const existing = await loadActive();
    if (existing?.status === "RUNNING") {
      const opposite =
        existing.job?.barcode === normalized.job.barcode &&
        existing.job?.desiredStatus !== normalized.job.desiredStatus;
      return {
        ok: false,
        code: opposite ? "STOCK_SYNC_OPPOSITE_JOB_BLOCKED" : "STOCK_SYNC_ALREADY_RUNNING",
        message: opposite
          ? `${normalized.job.barcode}의 반대 상태 작업이 이미 실행 중이라 중복·경합을 차단했습니다.`
          : `이미 ${existing.job?.barcode || "다른 B코드"} Shopling 작업이 실행 중입니다.`,
        active: existing,
      };
    }

    const preflight = await preflightWorkTabs(normalized.job);
    if (!preflight.ok) return preflight;
    const now = Date.now();
    const active = {
      status: "RUNNING",
      job: normalized.job,
      stage: "A6",
      stageStartedAt: now,
      startedAt: now,
      updatedAt: now,
      shoplingTabId: preflight.targets.A6?.tabId || null,
      shoplingFrameId: preflight.targets.A6?.frameId || null,
      workTabs: Object.fromEntries(
        Object.entries(preflight.targets).map(([stage, target]) => [
          stage,
          { tabId: target.tabId, frameId: target.frameId },
        ]),
      ),
      goodsKeyIndex: 0,
      attempts: {},
      evidence: [],
      message: `${normalized.job.barcode} · A6 옵션자체관리코드 읽기전용 조회로 전체 goods key 확인 준비`,
      extensionVersion: VERSION_V052,
    };
    await saveActive(active);
    await chrome.alarms.create(ALARM_NAME, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
    await progress(active, `${active.job.barcode} ${statusKorean(active.job.desiredStatus)} 동기화 · A6 B코드 읽기전용 조회 → 상품코드 확보 → API 상태변경 → A21 전건 직렬송신`, {
      preflightTabs: active.workTabs,
      goodsKeySource: "A6_LIVE_OPTION_BARCODE",
      initialCachedGoodsKeys: active.job.initialGoodsKeys,
      a6Mutation: "NONE_READ_ONLY_RESOLVER",
      extensionVersion: VERSION_V052,
    });
    const dispatched = await dispatchCurrent(active, { focus: true });
    if (!dispatched) {
      const result = await finish(active, "FAILED", "A6 옵션대량수정 작업창은 확인했지만 B코드 읽기전용 조회를 시작하지 못했습니다.", {
        code: "SHOPLING_A6_LIVE_DISPATCH_FAILED",
        extensionVersion: VERSION_V052,
      });
      return { ok: false, code: "SHOPLING_A6_LIVE_DISPATCH_FAILED", message: result.message, result };
    }
    return { ok: true, active: await loadActive(), message: active.message };
  };

  async function startSingleV052(input) {
    const normalized = legacyValidJobV052(input);
    if (!normalized.ok) return normalized;
    const existing = await loadActive();
    if (existing?.status === "RUNNING") {
      return { ok: false, code: "STOCK_SYNC_ALREADY_RUNNING", message: `이미 ${existing.job?.barcode || "다른 B코드"} Shopling 작업이 실행 중입니다.`, active: existing };
    }
    const preflight = await preflightWorkTabs(normalized.job);
    if (!preflight.ok) return preflight;
    const now = Date.now();
    const active = {
      status: "RUNNING", job: normalized.job, stage: "A4", stageStartedAt: now,
      startedAt: now, updatedAt: now,
      shoplingTabId: preflight.targets.A4?.tabId || null,
      shoplingFrameId: preflight.targets.A4?.frameId || null,
      workTabs: Object.fromEntries(Object.entries(preflight.targets).map(([stage, target]) => [stage, { tabId: target.tabId, frameId: target.frameId }])),
      goodsKeyIndex: 0, attempts: {}, evidence: [],
      message: "A4/A21 작업창 확인 완료 · 단품 상태변경 준비",
      extensionVersion: VERSION_V052,
    };
    await saveActive(active);
    await chrome.alarms.create(ALARM_NAME, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
    await progress(active, `${active.job.barcode} ${statusKorean(active.job.desiredStatus)} 동기화 · A4 → A21 상품판매상태 송신`, { preflightTabs: active.workTabs, extensionVersion: VERSION_V052 });
    const dispatched = await dispatchCurrent(active, { focus: true });
    if (!dispatched) {
      const result = await finish(active, "FAILED", "A4 작업창은 확인했지만 실행 메시지를 전달하지 못했습니다.", { code: "SHOPLING_A4_DISPATCH_FAILED", extensionVersion: VERSION_V052 });
      return { ok: false, code: "SHOPLING_A4_DISPATCH_FAILED", message: result.message, result };
    }
    return { ok: true, active: await loadActive(), message: active.message };
  }

  handleStepResult = async function handleStepResultV052(message, sender) {
    if (message?.stage !== "A6") return legacyHandleStepResultV052(message, sender);

    const active = await loadActive();
    if (!active || active.status !== "RUNNING" || message.jobId !== active.job?.jobId || active.stage !== "A6") {
      return legacyHandleStepResultV052(message, sender);
    }

    const result = message.result || {};
    if (!result.ok || !result.completed) return legacyHandleStepResultV052(message, sender);

    const discoveredGoodsKeys = Array.isArray(result?.evidence?.discoveredGoodsKeys)
      ? [...new Set(result.evidence.discoveredGoodsKeys.map((value) => norm(value)).filter((value) => /^\d+$/.test(value)))]
      : [];
    if (!discoveredGoodsKeys.length) {
      return {
        ok: false,
        result: await finish(active, "FAILED", `${active.job.barcode} A6 정확 검색결과에서 Shopling 상품코드(goods key)를 1건도 확보하지 못해 A21 전송을 차단했습니다.`, {
          code: "A6_BCODE_GOODSKEY_NOT_FOUND",
          a6Evidence: result.evidence || null,
          extensionVersion: VERSION_V052,
        }),
      };
    }

    active.job.goodsKeys = discoveredGoodsKeys;
    active.job.discoveredGoodsKeys = discoveredGoodsKeys;
    active.job.goodsKeySource = "A6_LIVE_OPTION_BARCODE";
    active.goodsKeyIndex = 0;
    await saveActive(active);
    await progress(active, `${active.job.barcode} · A6에서 상품코드 ${discoveredGoodsKeys.length}건 읽기 완료: ${discoveredGoodsKeys.join(", ")} · 체크 없이 API 옵션상태 적용 준비`, {
      discoveredGoodsKeys,
      goodsKeyCount: discoveredGoodsKeys.length,
      a6MatchedRows: Number(result?.evidence?.matchedRows || result?.evidence?.selectedRows || 0),
      a6ReadOnly: true,
      checkboxTouched: false,
      extensionVersion: VERSION_V052,
    });

    const apiResult = await applyOptionStatusViaOpsV054(active);
    if (!apiResult?.ok) {
      const partialCount = Array.isArray(apiResult?.results) ? apiResult.results.length : 0;
      return {
        ok: false,
        result: await finish(active, "FAILED", `${active.job.barcode} 상품코드별 Shopling 옵션상태 API 적용에 실패했습니다. 다시 실행하면 이미 적용된 항목은 검증만 하고 이어갈 수 있습니다. · ${apiResult?.message || "원인 미확인"}`, {
          code: apiResult?.code || "SHOPLING_OPTION_API_AFTER_A6_FAILED",
          retrySafe: true,
          partialAppliedCount: partialCount,
          failedGoodsKey: apiResult?.failedGoodsKey || null,
          optionApiResults: apiResult?.results || [],
          discoveredGoodsKeys,
          extensionVersion: VERSION_V052,
        }),
      };
    }

    active.job.optionApiApplied = true;
    active.job.optionApiEvidence = apiResult.results || [];
    active.stage = "A21_LIST";
    active.stageStartedAt = Date.now();
    active.goodsKeyIndex = 0;
    active.shoplingTabId = active.workTabs?.A21_LIST?.tabId || null;
    active.shoplingFrameId = active.workTabs?.A21_LIST?.frameId || null;
    await saveActive(active);
    await progress(active, `${active.job.barcode} · 상품코드 ${discoveredGoodsKeys.length}건 옵션상태 API 검증 완료 → A21 ${discoveredGoodsKeys.length}건 직렬 옵션송신 시작`, {
      discoveredGoodsKeys,
      optionApiResults: apiResult.results || [],
      optionApiApplied: true,
      extensionVersion: VERSION_V052,
    });

    const dispatched = await dispatchCurrent(active, { focus: true });
    if (!dispatched) {
      return {
        ok: false,
        result: await finish(active, "FAILED", "옵션상태 API 적용은 완료됐지만 A21 작업창으로 실행을 전달하지 못했습니다. 다시 실행하면 API는 목표상태를 재검증하고 A21부터 안전하게 재시도할 수 있습니다.", {
          code: "SHOPLING_A21_DISPATCH_FAILED_AFTER_OPTION_API_RETRY_SAFE",
          retrySafe: true,
          discoveredGoodsKeys,
          optionApiResults: apiResult.results || [],
          extensionVersion: VERSION_V052,
        }),
      };
    }
    return { ok: true, active: await loadActive() };
  };
})();
