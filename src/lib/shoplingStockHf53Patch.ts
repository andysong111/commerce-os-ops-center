function replaceOnce(source: string, before: string, after: string, code: string) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${code}:anchor_missing`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${code}:anchor_not_unique`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

const POPUP_STAGE_BEFORE = `    const popupOpeningStageHf47 = await stage(assignment.jobId, "POPUP_OPENING", {`;

const POPUP_STAGE_AFTER = `    const stalePopupPreflightHf53 = await chrome.runtime
      .sendMessage({
        type: "A21_STALE_POPUP_PREFLIGHT_HF53",
        jobId: assignment.jobId,
        stockProductKindHf48: String(assignment.stockProductKindHf48 || ""),
      })
      .catch(() => null);
    if (stalePopupPreflightHf53?.ok !== true) {
      return fail(
        assignment.jobId,
        String(stalePopupPreflightHf53?.code || "A21_STALE_POPUP_PREFLIGHT_FAILED_HF53"),
        String(stalePopupPreflightHf53?.message || "기존 A21 전송창의 안전 상태를 확인하지 못해 상품 수정전송을 클릭하지 않았습니다."),
      );
    }
    const popupOpeningStageHf47 = await stage(assignment.jobId, "POPUP_OPENING", {`;

export function patchShoplingStockHf53CanonicalWorker(source: string) {
  return replaceOnce(
    source.replace(/\r\n/g, "\n"),
    POPUP_STAGE_BEFORE,
    POPUP_STAGE_AFTER,
    "shopling_stock_hf53_stale_popup_preflight",
  );
}
