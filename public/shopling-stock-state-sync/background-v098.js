importScripts("background-v097.js");

// HF89 directly hands the exact popup observed by HF86 to HF84's proven
// mode -> dependent target -> original Shopling submit path. Chrome tab events
// remain a fallback, but they are no longer the only way to start the blue
// submit button flow.
(() => {
  const REQUEST_HF89 = "A21_EXACT_POPUP_HANDOFF_HF89";
  const VERSION_HF89 = chrome.runtime.getManifest().version;

  function normalizedHf89(value) {
    return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  function expectedListTabHf89(active) {
    const candidates = [
      active?.a21ExecutionWorkerHf76?.tabId,
      active?.workTabs?.A21_LIST?.tabId,
      active?.shoplingTabId,
    ];
    return candidates.map(Number).find(Number.isInteger) ?? null;
  }

  async function handoffExactPopupHf89(message, sender) {
    const active = await loadActive().catch(() => null);
    const senderTabId = Number(sender?.tab?.id);
    const popupTabId = Number(message?.popupTabId);
    const expectedListTabId = expectedListTabHf89(active);
    if (
      !active ||
      active.status !== "RUNNING" ||
      String(active?.job?.jobId || "") !== String(message?.jobId || "") ||
      !Number.isInteger(senderTabId) ||
      !Number.isInteger(expectedListTabId) ||
      senderTabId !== expectedListTabId ||
      !Number.isInteger(popupTabId)
    ) {
      return {
        ok: false,
        code: "HF89_EXACT_POPUP_HANDOFF_OWNER_MISMATCH",
        message: "현재 A21 목록 작업과 방금 열린 수정전송 팝업의 소유권이 일치하지 않습니다.",
      };
    }
    const direct = globalThis.__commerceOsHf84ExplicitPopupHandoff;
    if (typeof direct !== "function") {
      return {
        ok: false,
        code: "HF89_BLUE_SUBMIT_ENGINE_UNAVAILABLE",
        message: "검증된 파란 전송 버튼 실행기가 준비되지 않았습니다.",
      };
    }
    const result = await direct({
      jobId: String(message.jobId),
      popupTabId,
      expectedListTabId,
      goodsKeys: Array.isArray(message?.goodsKeys)
        ? message.goodsKeys.map(normalizedHf89).filter(Boolean)
        : [],
      extensionVersion: VERSION_HF89,
    });
    return {
      ...result,
      exactPopupHandoff: true,
      extensionVersion: VERSION_HF89,
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== REQUEST_HF89) return false;
    void handoffExactPopupHf89(message, sender)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({
          ok: false,
          code: "HF89_EXACT_POPUP_HANDOFF_UNHANDLED",
          message: normalizedHf89(error?.message || error || "팝업 직접 인계 실패"),
        }),
      );
    return true;
  });

  if (globalThis.__COMMERCE_OS_EXPOSE_STOCK_HF89_TEST_HOOKS__ === true) {
    globalThis.__commerceOsStockHf89TestHooks = {
      expectedListTabHf89,
      handoffExactPopupHf89,
    };
  }
})();
