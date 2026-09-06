importScripts("background-v040.js");

// v0.4.4: A21 modify-send popup self-claims the single active stock-sync job.
// This mirrors the proven A21 price/option resend assignment pattern so a popup that
// loads after the list worker submitted does not depend on one perfectly timed probe.
(() => {
  const VERSION_V044 = chrome.runtime.getManifest().version;
  const CLAIM = "STOCK_SYNC_A21_POPUP_CLAIM_V044";
  const TARGET_PATH = "/prodlinkage/goods_mallMdfy_trsmt.phtml";

  function exactPopupUrl(url) {
    try {
      const parsed = new URL(String(url || ""));
      return parsed.origin === "https://a.shopling.co.kr" && parsed.pathname.toLowerCase() === TARGET_PATH.toLowerCase();
    } catch {
      return false;
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== CLAIM) return;
    void (async () => {
      const tabId = sender?.tab?.id;
      const frameId = Number.isInteger(sender?.frameId) ? sender.frameId : 0;
      const href = String(message?.href || sender?.tab?.url || "");
      const active = await loadActive();
      if (!active || active.status !== "RUNNING" || active.stage !== "A21_POPUP") {
        sendResponse({ ok: false, error: "stock_popup_no_active_assignment", version: VERSION_V044 });
        return;
      }
      if (!Number.isInteger(tabId) || !exactPopupUrl(href)) {
        sendResponse({ ok: false, error: "stock_popup_claim_target_mismatch", version: VERSION_V044 });
        return;
      }
      const goodsKey = currentGoodsKey(active);
      if (!goodsKey) {
        sendResponse({ ok: false, error: "stock_popup_goods_key_missing", version: VERSION_V044 });
        return;
      }

      active.shoplingTabId = tabId;
      active.shoplingFrameId = frameId;
      active.workTabs = {
        ...(active.workTabs || {}),
        A21_POPUP: { tabId, frameId },
      };
      active.message = `A21 goods key ${goodsKey} 수정전송 팝업 self-claim 완료 · ${active.job.productKind === "OPTION" ? "옵션송신" : "상품판매상태송신"} form 설정`;
      await saveActive(active);
      await progress(active, active.message, {
        popupClaim: true,
        popupTabId: tabId,
        popupFrameId: frameId,
        extensionVersion: VERSION_V044,
      });
      sendResponse({
        ok: true,
        assignment: {
          job: active.job,
          stage: "A21_POPUP",
          expectedRole: "A21_POPUP",
          goodsKey,
          goodsKeyIndex: active.goodsKeyIndex,
          version: VERSION_V044,
        },
      });
    })().catch((error) => {
      sendResponse({ ok: false, error: String(error?.message || error || "stock_popup_claim_failed"), version: VERSION_V044 });
    });
    return true;
  });
})();
