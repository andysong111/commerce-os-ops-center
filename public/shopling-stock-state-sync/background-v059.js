importScripts("background-v058.js");

// HF17 SINGLE popup claim hardening.
// The popup URL itself is objective evidence that the A21 list worker already opened the
// transmit window. Do not depend on the mutable canonical stage string to authorize the
// dedicated SINGLE sale-status worker. OPTION/HF10 remains untouched.
(() => {
  const VERSION_V059 = chrome.runtime.getManifest().version;
  const SINGLE_CLAIM_V012 = "STOCK_SINGLE_POPUP_CLAIM_V012";
  const POPUP_PATH = "/prodlinkage/goods_mallMdfy_trsmt.phtml";

  function exactPopupUrlV059(url) {
    try {
      const parsed = new URL(String(url || ""));
      return parsed.origin === "https://a.shopling.co.kr" && parsed.pathname.toLowerCase() === POPUP_PATH.toLowerCase();
    } catch {
      return false;
    }
  }

  async function claimSinglePopupV059(message, sender) {
    const active = await loadActive();
    if (!active || active.status !== "RUNNING" || active.job?.productKind !== "SINGLE") {
      return { ok: false, error: "stock_single_popup_no_active_job" };
    }

    const tabId = sender?.tab?.id;
    const frameId = Number.isInteger(sender?.frameId) ? sender.frameId : 0;
    const href = String(message?.href || sender?.tab?.url || "");
    if (!Number.isInteger(tabId) || !exactPopupUrlV059(href)) {
      return { ok: false, error: "stock_single_popup_target_mismatch" };
    }

    // Accept only the list->popup transition (or an idempotent re-claim of the same popup).
    // Crucially, do not require singleA21CanonicalStage === POPUP_OPENING because that
    // value is mutable and may be SEARCH_SUBMITTED/retry-derived by the time this document
    // becomes interactive.
    if (!["A21_LIST", "A21_POPUP"].includes(String(active.stage || ""))) {
      return { ok: false, error: "stock_single_popup_not_ready" };
    }
    if (active.stage === "A21_POPUP" && Number.isInteger(active.singlePopupTabId) && active.singlePopupTabId !== tabId) {
      return { ok: false, error: "stock_single_popup_other_window_active" };
    }

    const batchKeys = Array.isArray(active.singleCurrentBatchKeys)
      ? active.singleCurrentBatchKeys.map((value) => norm(value)).filter((value) => /^\d+$/.test(value))
      : [];
    const goodsKey = batchKeys[0] || currentGoodsKey(active);
    if (!goodsKey) return { ok: false, error: "stock_single_popup_goods_key_missing" };

    active.stage = "A21_POPUP";
    active.stageStartedAt = Date.now();
    active.shoplingTabId = tabId;
    active.shoplingFrameId = frameId;
    active.singlePopupTabId = tabId;
    active.singlePopupWindowId = sender?.tab?.windowId ?? null;
    active.workTabs = { ...(active.workTabs || {}), A21_POPUP: { tabId, frameId } };
    await saveActive(active);
    await progress(active, `A21 단품 송신창 연결 · 상품판매상태 ${statusKorean(active.job.desiredStatus)} 정확 선택 worker v012 실행`, {
      popupEngine: "STOCK_SINGLE_SALE_STATUS_V012_EXACT_LOCATOR",
      popupTabId: tabId,
      popupFrameId: frameId,
      canonicalStageAtClaim: active.singleA21CanonicalStage || null,
      batchKeys,
      extensionVersion: VERSION_V059,
    });
    return {
      ok: true,
      assignment: {
        jobId: active.job.jobId,
        goodsKey,
        goodsKeys: batchKeys,
        desiredStatus: active.job.desiredStatus,
      },
      version: VERSION_V059,
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== SINGLE_CLAIM_V012) return;
    void claimSinglePopupV059(message, sender)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error || "stock_single_popup_claim_v012_failed") }));
    return true;
  });
})();
