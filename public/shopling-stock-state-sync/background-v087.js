importScripts("background-v086.js");

// HF65: Commerce OS resolves and mutates the exact B-code through Shopling API.
// The browser owns only the final A21 marketplace transmission start.
(() => {
  const VERSION_V087 = chrome.runtime.getManifest().version;
  const legacyStartV087 = start;
  const legacyContinueNextGoodsKeyV087 = continueNextGoodsKey;

  function apiReadyJobV087(input) {
    const job = input && typeof input === "object" ? input : {};
    const jobId = norm(job.jobId);
    const barcode = norm(job.barcode).toUpperCase().replace(/\s+/g, "");
    const productKind = norm(job.productKind).toUpperCase();
    const desiredStatus = norm(job.desiredStatus).toUpperCase();
    const goodsKeys = Array.isArray(job.goodsKeys)
      ? [...new Set(job.goodsKeys.map((value) => norm(value)).filter((value) => /^\d+$/.test(value)))]
      : [];
    if (!jobId) return { ok: false, code: "STOCK_SYNC_JOB_ID_REQUIRED", message: "작업 ID가 없습니다." };
    if (!/^B[A-Z]{2}\d+-\d+$/.test(barcode)) return { ok: false, code: "STOCK_SYNC_BARCODE_INVALID", message: "B코드 형식이 올바르지 않습니다." };
    if (!["OPTION", "SINGLE"].includes(productKind)) return { ok: false, code: "STOCK_SYNC_PRODUCT_KIND_INVALID", message: "상품형태가 올바르지 않습니다." };
    if (!["SOLD_OUT", "ON_SALE"].includes(desiredStatus)) return { ok: false, code: "STOCK_SYNC_DESIRED_STATUS_INVALID", message: "목표상태가 올바르지 않습니다." };
    if (!goodsKeys.length) return { ok: false, code: "STOCK_SYNC_GOODS_KEY_REQUIRED", message: "API 검증 goods key가 없습니다." };
    if (!Array.isArray(job.stockStateApiEvidence) || job.stockStateApiEvidence.length !== goodsKeys.length) {
      return { ok: false, code: "SHOPLING_API_RECEIPT_COUNT_MISMATCH", message: "API 검증 영수증 수가 goods key 수와 일치하지 않습니다." };
    }
    return { ok: true, job: { ...job, jobId, barcode, productKind, desiredStatus, goodsKeys } };
  }

  start = async function startV087(input) {
    if (input?.stockStateApiApplied !== true) return legacyStartV087(input);
    const normalized = apiReadyJobV087(input);
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
      attempts: {},
      evidence: [],
      message: `${normalized.job.barcode} API 상태·수량 검증 완료 · A21 전송 준비`,
      extensionVersion: VERSION_V087,
    };
    await saveActive(active);
    await chrome.alarms.create(ALARM_NAME, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
    await progress(active, `${active.job.barcode} · API 검증 goods key ${active.job.goodsKeys.length}건 → A21 전송 시작`, {
      apiOnlyPreflight: true,
      browserStagesSkipped: ["A4", "A6"],
      stockStateApiEvidence: active.job.stockStateApiEvidence,
      extensionVersion: VERSION_V087,
    });
    const dispatched = await dispatchCurrent(active, { focus: true });
    if (!dispatched) {
      const result = await finish(active, "FAILED", "API 상태 검증은 완료됐지만 A21 작업창에 실행 메시지를 전달하지 못했습니다.", {
        code: "SHOPLING_A21_DISPATCH_FAILED_AFTER_API",
        retrySafe: true,
        stockStateApiEvidence: active.job.stockStateApiEvidence,
      });
      return { ok: false, code: "SHOPLING_A21_DISPATCH_FAILED_AFTER_API", message: result.message, result };
    }
    return { ok: true, active: await loadActive(), message: active.message };
  };

  continueNextGoodsKey = async function continueNextGoodsKeyV087(active, sender, evidence) {
    if (active?.job?.stockStateApiApplied !== true) {
      return legacyContinueNextGoodsKeyV087(active, sender, evidence);
    }
    const nextIndex = Number(active.goodsKeyIndex || 0) + 1;
    if (nextIndex >= active.job.goodsKeys.length) {
      return {
        ok: true,
        result: await finish(active, "SUCCEEDED", `${active.job.barcode} Shopling A21 전송 접수 완료 · goods key ${active.job.goodsKeys.length}건`, {
          result: evidence,
          resultTabId: sender?.tab?.id,
          resultFrameId: sender?.frameId,
          stockStateApiEvidence: active.job.stockStateApiEvidence,
          commerceOsBoundary: "A21_PROCESSING_OR_RESULT_SCREEN_STARTED",
        }),
      };
    }
    active.goodsKeyIndex = nextIndex;
    active.stage = "A21_LIST";
    active.stageStartedAt = Date.now();
    active.attempts = {};
    await progress(active, `다음 API 검증 goods key ${currentGoodsKey(active)} A21 전송 계속`, {
      stockStateApiApplied: true,
    });
    await sleep(350);
    const dispatched = await dispatchCurrent(active, { focus: true });
    if (dispatched) return { ok: true, continuing: true };
    return {
      ok: false,
      result: await finish(active, "FAILED", `다음 goods key ${currentGoodsKey(active)} A21 작업창을 찾지 못했습니다.`, {
        code: "SHOPLING_A21_TAB_LOST_DURING_API_FIRST_RUN",
        retrySafe: true,
      }),
    };
  };
})();
