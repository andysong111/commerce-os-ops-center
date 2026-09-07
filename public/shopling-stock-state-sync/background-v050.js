importScripts("background-v040.js");

// v0.5.0: OPTION popup execution reuses the proven A21 Price/Option Resend popup core.
(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const CLAIM = "STOCK_PRICE_CORE_POPUP_CLAIM_V050";
  const STAGE = "STOCK_PRICE_CORE_STAGE_V050";
  const FAILURE = "STOCK_PRICE_CORE_FAILURE_V050";
  const TARGET_PATH = "/prodlinkage/goods_mallMdfy_trsmt.phtml";
  const legacyDispatchCurrent = dispatchCurrent;

  function exactPopupUrl(url) {
    try {
      const parsed = new URL(String(url || ""));
      return parsed.origin === "https://a.shopling.co.kr" && parsed.pathname.toLowerCase() === TARGET_PATH.toLowerCase();
    } catch {
      return false;
    }
  }

  dispatchCurrent = async function dispatchCurrentV050(active, options = {}) {
    if (active?.job?.productKind === "OPTION" && active.stage === "A21_POPUP") return true;
    return legacyDispatchCurrent(active, options);
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (![CLAIM, STAGE, FAILURE].includes(message?.type)) return;
    void (async () => {
      const active = await loadActive();
      if (!active || active.status !== "RUNNING") {
        sendResponse({ ok: false, error: "stock_price_core_no_active_job", version: VERSION });
        return;
      }

      if (message.type === CLAIM) {
        const tabId = sender?.tab?.id;
        const frameId = Number.isInteger(sender?.frameId) ? sender.frameId : 0;
        const href = String(message?.href || sender?.tab?.url || "");
        if (active.stage !== "A21_POPUP" || active.job?.productKind !== "OPTION") {
          sendResponse({ ok: false, error: "stock_price_core_not_option_popup_stage", version: VERSION });
          return;
        }
        if (!Number.isInteger(tabId) || !exactPopupUrl(href)) {
          sendResponse({ ok: false, error: "stock_price_core_popup_target_mismatch", version: VERSION });
          return;
        }
        const goodsKey = currentGoodsKey(active);
        if (!goodsKey) {
          sendResponse({ ok: false, error: "stock_price_core_goods_key_missing", version: VERSION });
          return;
        }
        active.shoplingTabId = tabId;
        active.shoplingFrameId = frameId;
        active.workTabs = { ...(active.workTabs || {}), A21_POPUP: { tabId, frameId } };
        active.message = `A21 goods key ${goodsKey} 팝업 연결 · 검증된 가격조정 옵션송신 코어 실행`;
        await saveActive(active);
        await progress(active, active.message, {
          popupClaim: true,
          popupTabId: tabId,
          popupFrameId: frameId,
          extensionVersion: VERSION,
          popupEngine: "PRICE_CORE_V024",
        });
        sendResponse({
          ok: true,
          assignment: { jobId: active.job.jobId, mode: "OPTION", goodsKey },
          version: VERSION,
        });
        return;
      }

      if (String(message?.jobId || "") !== String(active.job?.jobId || "")) {
        sendResponse({ ok: false, error: "stock_price_core_stale_job", version: VERSION });
        return;
      }

      if (message.type === STAGE) {
        const next = String(message?.stage || "");
        if (next === "RESULT_WAIT") {
          active.stage = "WAIT_A21_RESULT";
          active.stageStartedAt = Date.now();
        }
        await progress(active, String(message?.message || `PriceCore ${next}`), {
          priceCoreStage: next,
          extensionVersion: VERSION,
        });
        sendResponse({ ok: true, version: VERSION });
        return;
      }

      if (message.type === FAILURE) {
        const code = String(message?.code || "PRICE_CORE_POPUP_FAILED");
        const text = String(message?.message || "A21 옵션송신 팝업 처리 실패");
        const uncertain = /MAIN_SUBMIT|RESULT_WAIT|SUBMIT_CLICKED/i.test(code);
        const result = await finish(active, uncertain ? "UNCERTAIN" : "FAILED", text, {
          code,
          popupEngine: "PRICE_CORE_V024",
          extensionVersion: VERSION,
        });
        sendResponse({ ok: true, result, version: VERSION });
      }
    })().catch((error) => {
      sendResponse({
        ok: false,
        error: String(error?.message || error || "stock_price_core_adapter_failed"),
        version: VERSION,
      });
    });
    return true;
  });
})();

// v0.5.1 operator policy hotfix:
// Once Shopling itself reports the expected A21 completion, marketplace-level failures are advisory.
// They remain in evidence for later cleanup, but do not stop serial stock-state synchronization.
const legacyHandleEvidenceV051 = handleEvidence;
handleEvidence = async function handleEvidenceV051(message, sender) {
  const active = await loadActive();
  if (!active || active.status !== "RUNNING" || active.stage !== "WAIT_A21_RESULT") {
    return legacyHandleEvidenceV051(message, sender);
  }

  const evidence = message?.evidence || {};
  if (evidence.processing) return legacyHandleEvidenceV051(message, sender);

  const expectedComplete =
    active.job?.productKind === "OPTION"
      ? Boolean(evidence.optionComplete)
      : Boolean(evidence.productComplete);
  if (!expectedComplete || evidence.readyState !== "complete") {
    return legacyHandleEvidenceV051(message, sender);
  }

  const rawFailureCount = Number(evidence.failureCount || 0);
  const marketplaceFailureCount =
    Number.isFinite(rawFailureCount) && rawFailureCount > 0 ? rawFailureCount : 0;
  const marketplaceFailureText = Boolean(evidence.explicitFailure);
  const marketplaceFailuresIgnored = marketplaceFailureCount > 0 || marketplaceFailureText;
  const normalizedEvidence = {
    ...evidence,
    marketplaceFailuresIgnored,
    marketplaceFailureCount,
    marketplaceFailureText,
    completionPolicy: "SHOPLING_A21_COMPLETION_AUTHORITATIVE_MARKETPLACE_FAILURES_ADVISORY",
  };

  if (marketplaceFailuresIgnored) {
    await progress(
      active,
      `${stageLabel(active.stage, active.job.productKind)} · Shopling 완료 확인 · 마켓별 실패 ${marketplaceFailureCount}건은 기록만 하고 성공 판정`,
      {
        resultTabId: sender?.tab?.id,
        resultFrameId: sender?.frameId,
        result: normalizedEvidence,
        marketplaceFailuresIgnored: true,
      },
    );
  }

  return continueNextGoodsKey(active, sender, normalizedEvidence);
};
