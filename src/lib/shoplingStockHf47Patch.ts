function replaceOnce(source: string, before: string, after: string, code: string) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${code}:anchor_not_unique`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}
const STAGE_BEFORE = `  async function stage(jobId, nextStage, extra = {}) {
    await chrome.runtime.sendMessage({ type: "A21_STAGE", jobId, stage: nextStage, ...extra }).catch(() => null);
  }`;

const STAGE_AFTER = `  async function stage(jobId, nextStage, extra = {}) {
    let responseHf47 = null;
    for (let attemptHf47 = 1; attemptHf47 <= 2; attemptHf47 += 1) {
      responseHf47 = await chrome.runtime
        .sendMessage({ type: "A21_STAGE", jobId, stage: nextStage, ...extra })
        .catch(() => null);
      if (responseHf47?.ok === true && responseHf47?.accepted === true) return responseHf47;
      if (attemptHf47 < 2) await sleep(120);
    }
    return responseHf47;
  }`;

const POPUP_OPENING_BEFORE = `    await stage(assignment.jobId, "POPUP_OPENING", {
      selectedRowCount: checked,
      totalResultCount: total,
      requestedGoodsKeyCount: assignment.goodsKeys.length,
      matchedGoodsKeyCount: seen.size,
      missingGoodsKeys: singleStockBatch ? missing : [],
      missingGoodsKeysIgnored: Boolean(singleStockBatch && missing.length),
      returnedRowsRestrictedToRequestedGoodsKeys: matched.length === total,
      message: singleStockBatch && missing.length
        ? \`${'${checked}'}개 쇼핑몰 행 선택 완료 · 삭제/미존재 GOODSKEY ${'${missing.length}'}건 무시\`
        : \`${'${checked}'}개 쇼핑몰 행 선택 완료\`,
    });
    if (!clickModifySend()) return fail(assignment.jobId, "A21_MODIFY_SEND_BUTTON_NOT_FOUND", "상품 수정전송 버튼을 찾지 못했습니다.");`;

const POPUP_OPENING_AFTER = `    const popupOpeningStageHf47 = await stage(assignment.jobId, "POPUP_OPENING", {
      selectedRowCount: checked,
      totalResultCount: total,
      requestedGoodsKeyCount: assignment.goodsKeys.length,
      matchedGoodsKeyCount: seen.size,
      missingGoodsKeys: singleStockBatch ? missing : [],
      missingGoodsKeysIgnored: Boolean(singleStockBatch && missing.length),
      returnedRowsRestrictedToRequestedGoodsKeys: matched.length === total,
      message: singleStockBatch && missing.length
        ? \`${'${checked}'}개 쇼핑몰 행 선택 완료 · 삭제/미존재 GOODSKEY ${'${missing.length}'}건 무시\`
        : \`${'${checked}'}개 쇼핑몰 행 선택 완료\`,
    });
    if (popupOpeningStageHf47?.ok !== true || popupOpeningStageHf47?.accepted !== true) {
      return fail(
        assignment.jobId,
        "A21_POPUP_OPENING_STAGE_NOT_ACKNOWLEDGED_HF47",
        "A21 팝업 열기 상태가 작업 원장에 저장되지 않아 상품 수정전송을 클릭하지 않았습니다.",
      );
    }
    if (!clickModifySend()) return fail(assignment.jobId, "A21_MODIFY_SEND_BUTTON_NOT_FOUND", "상품 수정전송 버튼을 찾지 못했습니다.");`;

const STALE_RECOVERY_ANCHOR = `  setTimeout(() => void recoverPersistedFalsePopupState("serviceWorkerStart"), 900);
  chrome.runtime.onInstalled.addListener(() => {
    setTimeout(() => void recoverPersistedFalsePopupState("onInstalled"), 900);
  });`;

const STALE_RECOVERY_AFTER = `  async function failStaleSearchSubmittedHf47(trigger) {
    const active = await loadActive();
    if (
      !active ||
      active.status !== "RUNNING" ||
      active.job?.productKind !== "OPTION" ||
      active.job?.optionApiApplied !== true ||
      active.stage !== "A21_LIST" ||
      active.a21CanonicalStage !== "SEARCH_SUBMITTED"
    ) {
      return null;
    }

    const staleAgeMs = Date.now() - Number(active.a21CanonicalStageAt || active.stageStartedAt || 0);
    if (staleAgeMs < 30_000) return null;

    const popupTabs = await chrome.tabs.query({ url: POPUP_MATCH }).catch(() => []);
    const popupPresent = popupTabs.some((tab) => Number.isInteger(tab?.id));
    const status = popupPresent ? "UNCERTAIN" : "FAILED";
    return finish(
      active,
      status,
      popupPresent
        ? \`${'${active.job.barcode}'} · A21 팝업 열기 상태 저장이 확인되지 않았고 팝업이 남아 있어 자동 재시도를 중지했습니다.\`
        : \`${'${active.job.barcode}'} · A21 팝업 열기 상태 저장이 확인되지 않아 외부 전송 없이 작업을 실패로 종료했습니다.\`,
      {
        code: popupPresent
          ? "A21_POPUP_OPENING_STAGE_ACK_LOST_POPUP_PRESENT_HF47"
          : "A21_POPUP_OPENING_STAGE_ACK_LOST_NO_POPUP_HF47",
        trigger,
        canonicalStage: active.a21CanonicalStage,
        staleAgeMs,
        popupPresent,
        optionApiMutationRepeatedByRecovery: false,
        a21TransmissionSubmittedByRecovery: false,
        priorA21TransmissionSubmitted: popupPresent ? null : false,
        retryAllowedAutomatically: false,
        incident: "BDE7-3_SIX_NOOP_OPTIONS_POPUP_OPENED_WITHOUT_STAGE_ACK",
      },
    );
  }

  setTimeout(() => void recoverPersistedFalsePopupState("serviceWorkerStart"), 900);
  setTimeout(() => void failStaleSearchSubmittedHf47("serviceWorkerStart"), 1_200);
  chrome.runtime.onInstalled.addListener(() => {
    setTimeout(() => void recoverPersistedFalsePopupState("onInstalled"), 900);
    setTimeout(() => void failStaleSearchSubmittedHf47("onInstalled"), 1_200);
  });`;

export function patchShoplingStockHf47CanonicalWorker(source: string) {
  const normalized = source.replace(/\r\n/g, "\n");
  return replaceOnce(
    replaceOnce(
      normalized,
      STAGE_BEFORE,
      STAGE_AFTER,
      "shopling_stock_hf47_stage_response",
    ),
    POPUP_OPENING_BEFORE,
    POPUP_OPENING_AFTER,
    "shopling_stock_hf47_popup_open_ack",
  );
}

export function patchShoplingStockHf47Background(source: string) {
  return replaceOnce(
    source.replace(/\r\n/g, "\n"),
    STALE_RECOVERY_ANCHOR,
    STALE_RECOVERY_AFTER,
    "shopling_stock_hf47_stale_search_recovery",
  );
}
