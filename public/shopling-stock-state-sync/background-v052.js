importScripts("background-v050.js");

// v0.5.2: OPTION jobs resolve their complete goods-key set live from A6 on every run.
// Cached/server goods keys are never authoritative for option transmission.
(() => {
  const VERSION_V052 = chrome.runtime.getManifest().version;
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
        goodsKeySource: "A6_LIVE_OPTION_BARCODE",
      },
    };
  };

  requiredStages = function requiredStagesV052(productKind) {
    return productKind === "OPTION" ? ["A6", "A21_LIST"] : ["A4", "A21_LIST"];
  };

  start = async function startV052(input) {
    const normalized = validJob(input);
    if (!normalized.ok) return normalized;
    if (normalized.job.productKind !== "OPTION") {
      // SINGLE keeps the established A4 -> A21 implementation.
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
      message: `${normalized.job.barcode} · A6 옵션자체관리코드 실시간 조회로 전체 goods key 확인 준비`,
      extensionVersion: VERSION_V052,
    };
    await saveActive(active);
    await chrome.alarms.create(ALARM_NAME, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
    await progress(active, `${active.job.barcode} ${statusKorean(active.job.desiredStatus)} 동기화 · A6 실시간 B코드 조회 → 전체 goods key 확보 → A21 전건 직렬송신`, {
      preflightTabs: active.workTabs,
      goodsKeySource: "A6_LIVE_OPTION_BARCODE",
      initialCachedGoodsKeys: active.job.initialGoodsKeys,
      extensionVersion: VERSION_V052,
    });
    const dispatched = await dispatchCurrent(active, { focus: true });
    if (!dispatched) {
      const result = await finish(active, "FAILED", "A6 옵션대량수정 작업창은 확인했지만 B코드 실시간 조회를 시작하지 못했습니다.", {
        code: "SHOPLING_A6_LIVE_DISPATCH_FAILED",
        extensionVersion: VERSION_V052,
      });
      return { ok: false, code: "SHOPLING_A6_LIVE_DISPATCH_FAILED", message: result.message, result };
    }
    return { ok: true, active: await loadActive(), message: active.message };
  };

  async function startSingleV052(input) {
    // Recreate the pre-v0.4 SINGLE start path without touching its mutation contract.
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
    if (message?.stage === "A6") {
      const active = await loadActive();
      if (active?.status === "RUNNING" && message.jobId === active.job?.jobId && active.stage === "A6") {
        const result = message.result || {};
        if (result.ok && result.completed) {
          const discoveredGoodsKeys = Array.isArray(result?.evidence?.discoveredGoodsKeys)
            ? [...new Set(result.evidence.discoveredGoodsKeys.map((value) => norm(value)).filter((value) => /^\d+$/.test(value)))]
            : [];
          if (!discoveredGoodsKeys.length) {
            return {
              ok: false,
              result: await finish(active, "FAILED", `${active.job.barcode} A6 정확 검색행에서 Shopling 상품코드(goods key)를 1건도 확보하지 못해 A21 전송을 차단했습니다.`, {
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
          await progress(active, `${active.job.barcode} · A6에서 goods key ${discoveredGoodsKeys.length}건 확보: ${discoveredGoodsKeys.join(", ")} · A21 전건 직렬송신 준비`, {
            discoveredGoodsKeys,
            goodsKeyCount: discoveredGoodsKeys.length,
            a6MatchedRows: Number(result?.evidence?.selectedRows || 0),
            extensionVersion: VERSION_V052,
          });
        }
      }
    }
    return legacyHandleStepResultV052(message, sender);
  };
})();
