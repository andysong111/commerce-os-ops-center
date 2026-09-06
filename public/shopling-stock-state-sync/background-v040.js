importScripts("background-v030.js");

// v0.4.0 cutover:
// OPTION jobs no longer operate A6. Commerce OS server API first verifies/mutates the
// exact B-code option, preserving Shopling optQty, then this worker performs A21 only.
(() => {
  const VERSION_V040 = "0.4.0";
  const legacyRequiredStagesV040 = requiredStages;
  const legacyStartV040 = start;

  requiredStages = function requiredStagesV040(productKind) {
    return productKind === "OPTION"
      ? ["A21_LIST"]
      : legacyRequiredStagesV040(productKind);
  };

  start = async function startV040(input) {
    const normalized = validJob(input);
    if (!normalized.ok) return normalized;
    if (normalized.job.productKind !== "OPTION") {
      return legacyStartV040(input);
    }
    if (normalized.job.optionApiApplied !== true) {
      return {
        ok: false,
        code: "SHOPLING_OPTION_API_NOT_APPLIED",
        message: `${normalized.job.barcode} Shopling API 옵션상태 검증이 완료되지 않아 A21 전송을 차단했습니다.`,
      };
    }
    if (
      normalized.job.goodsKeys.length !== 1 ||
      !/^\d+$/.test(String(normalized.job.goodsKeys[0] || ""))
    ) {
      return {
        ok: false,
        code: "SHOPLING_OPTION_API_GOODS_KEY_NOT_EXACT",
        message: `${normalized.job.barcode} API 검증 goods key가 정확히 1건이 아니어서 A21 전송을 차단했습니다.`,
      };
    }

    const existing = await loadActive();
    if (existing?.status === "RUNNING") {
      const opposite =
        existing.job?.barcode === normalized.job.barcode &&
        existing.job?.desiredStatus !== normalized.job.desiredStatus;
      return {
        ok: false,
        code: opposite
          ? "STOCK_SYNC_OPPOSITE_JOB_BLOCKED"
          : "STOCK_SYNC_ALREADY_RUNNING",
        message: opposite
          ? `${normalized.job.barcode}의 반대 상태 작업이 이미 실행 중이라 중복·경합을 차단했습니다.`
          : `이미 ${existing.job?.barcode || "다른 B코드"} Shopling 작업이 실행 중입니다.`,
        active: existing,
      };
    }

    const preflight = await preflightWorkTabs(normalized.job);
    if (!preflight.ok) return preflight;

    const now = Date.now();
    const firstStage = "A21_LIST";
    const active = {
      status: "RUNNING",
      job: normalized.job,
      stage: firstStage,
      stageStartedAt: now,
      startedAt: now,
      updatedAt: now,
      shoplingTabId: preflight.targets[firstStage]?.tabId || null,
      shoplingFrameId: preflight.targets[firstStage]?.frameId || null,
      workTabs: Object.fromEntries(
        Object.entries(preflight.targets).map(([stage, target]) => [
          stage,
          { tabId: target.tabId, frameId: target.frameId },
        ]),
      ),
      goodsKeyIndex: 0,
      attempts: {},
      evidence: [],
      message: `Shopling API 옵션상태 검증 완료 · A21 goods key ${normalized.job.goodsKeys[0]} 옵션송신 준비`,
      extensionVersion: VERSION_V040,
    };
    await saveActive(active);
    await chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: 0.5,
      periodInMinutes: 0.5,
    });
    await progress(
      active,
      `${active.job.barcode} ${statusKorean(active.job.desiredStatus)} 동기화 · API 로컬 옵션상태 확인 완료 → A21 goods key ${currentGoodsKey(active)} 옵션송신`,
      {
        preflightTabs: active.workTabs,
        optionApiEvidence: active.job.optionApiEvidence || null,
        extensionVersion: VERSION_V040,
      },
    );

    const dispatched = await dispatchCurrent(active, { focus: true });
    if (!dispatched) {
      const result = await finish(
        active,
        "FAILED",
        `A21 쇼핑몰상품수정 작업창은 확인했지만 실행 메시지를 전달하지 못했습니다. Shopling 로그인 상태를 확인한 뒤 다시 시도하세요.`,
        {
          code: "SHOPLING_A21_DISPATCH_FAILED_AFTER_OPTION_API",
          optionApiEvidence: active.job.optionApiEvidence || null,
          extensionVersion: VERSION_V040,
        },
      );
      return {
        ok: false,
        code: "SHOPLING_A21_DISPATCH_FAILED_AFTER_OPTION_API",
        message: result.message,
        result,
      };
    }
    return {
      ok: true,
      active: await loadActive(),
      message: active.message,
    };
  };
})();
