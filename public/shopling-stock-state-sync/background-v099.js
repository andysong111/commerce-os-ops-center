importScripts("background-v098.js");

// HF90 closes the receipt gap left by HF89. The trusted red-button path handed
// the exact popup directly to HF84, but it did not persist that popup in the
// owner fields consumed by the proven HF60/HF72 processing/result watcher.
// Bind the exact popup before the blue submit so processing evidence and nested
// result navigation are credited to the current job instead of timing out.
(() => {
  const VERSION_HF90 = chrome.runtime.getManifest().version;
  const originalExplicitHandoffHf90 =
    globalThis.__commerceOsHf84ExplicitPopupHandoff;

  function normalizedHf90(value) {
    return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  function exactPopupUrlHf90(value) {
    try {
      const url = new URL(String(value || ""));
      return (
        (url.hostname === "a.shopling.co.kr" ||
          url.hostname === "kt.shopling.co.kr") &&
        url.pathname.toLowerCase() ===
          "/prodlinkage/goods_mallmdfy_trsmt.phtml"
      );
    } catch {
      return false;
    }
  }

  function expectedListTabHf90(active) {
    const candidates = [
      active?.a21ExecutionWorkerHf76?.tabId,
      active?.workTabs?.A21_LIST?.tabId,
      active?.shoplingTabId,
    ];
    return candidates.map(Number).find(Number.isInteger) ?? null;
  }

  async function bindExactPopupOwnerHf90(input) {
    const popupTabId = Number(input?.popupTabId);
    const jobId = normalizedHf90(input?.jobId);
    const active = await loadActive().catch(() => null);
    const expectedListTabId = expectedListTabHf90(active);
    if (
      !active ||
      active.status !== "RUNNING" ||
      normalizedHf90(active?.job?.jobId) !== jobId ||
      !Number.isInteger(expectedListTabId) ||
      !Number.isInteger(popupTabId)
    ) {
      return {
        ok: false,
        code: "HF90_EXACT_POPUP_OWNER_INPUT_MISMATCH",
        message: "현재 작업과 방금 열린 Shopling 수정전송 팝업을 연결하지 못했습니다.",
      };
    }

    const popup = await chrome.tabs.get(popupTabId).catch(() => null);
    const openerTabId = Number(popup?.openerTabId);
    if (
      !popup ||
      !exactPopupUrlHf90(popup.url || popup.pendingUrl) ||
      (Number.isInteger(openerTabId) && openerTabId !== expectedListTabId)
    ) {
      return {
        ok: false,
        code: "HF90_EXACT_POPUP_OWNER_CHAIN_MISMATCH",
        message: "방금 열린 Shopling 수정전송 팝업의 소유 목록창이 현재 작업과 다릅니다.",
      };
    }

    active.workTabs = {
      ...(active.workTabs || {}),
      A21_LIST: {
        ...(active.workTabs?.A21_LIST || {}),
        tabId: expectedListTabId,
      },
      A21_POPUP: {
        tabId: popupTabId,
        frameId: 0,
        windowId: Number.isInteger(Number(popup.windowId))
          ? Number(popup.windowId)
          : null,
        openerTabId: Number.isInteger(openerTabId) ? openerTabId : null,
        assignmentOwnerKey:
          active?.a21PopupOwnershipHf81?.assignmentOwnerKey || null,
        establishedBy: "HF90_EXACT_TRUSTED_POPUP_HANDOFF",
        establishedAt: Date.now(),
      },
    };
    active.shoplingDispatchReceiptHf90 = {
      jobId,
      popupTabId,
      expectedListTabId,
      exactOwnerBound: true,
      externalWriteConfirmed: false,
      retrySafe: false,
      code: "HF90_EXACT_POPUP_OWNER_BOUND_BEFORE_SUBMIT",
      recordedAt: Date.now(),
    };
    await saveActive(active);
    return {
      ok: true,
      popupTabId,
      expectedListTabId,
      windowId: active.workTabs.A21_POPUP.windowId,
    };
  }

  async function recordCommittedReceiptHf90(input, result) {
    if (result?.committed !== true) return false;
    const latest = await loadActive().catch(() => null);
    const popupTabId = Number(input?.popupTabId);
    if (
      !latest ||
      latest.status !== "RUNNING" ||
      latest.stage !== "WAIT_A21_RESULT" ||
      normalizedHf90(latest?.job?.jobId) !== normalizedHf90(input?.jobId) ||
      Number(latest?.workTabs?.A21_POPUP?.tabId) !== popupTabId
    ) {
      return false;
    }
    latest.shoplingDispatchReceiptHf90 = {
      ...(latest.shoplingDispatchReceiptHf90 || {}),
      jobId: normalizedHf90(input?.jobId),
      popupTabId,
      expectedListTabId: expectedListTabHf90(latest),
      exactOwnerBound: true,
      externalWriteConfirmed: true,
      retrySafe: false,
      code: "HF90_EXACT_POPUP_BLUE_SUBMIT_COMMITTED_AND_OWNED",
      committedAt: Date.now(),
      extensionVersion: VERSION_HF90,
      lastMileReceipt: result?.receipt || latest?.lastMileReceiptHf84 || null,
    };
    await saveActive(latest);
    return true;
  }

  async function explicitPopupHandoffHf90(input) {
    if (typeof originalExplicitHandoffHf90 !== "function") {
      return {
        ok: false,
        code: "HF90_HF89_HANDOFF_UNAVAILABLE",
        message: "검증된 Shopling 파란 전송 실행기를 불러오지 못했습니다.",
      };
    }
    const owner = await bindExactPopupOwnerHf90(input);
    if (!owner.ok) return owner;

    const result = await originalExplicitHandoffHf90(input);
    const committedReceiptPersisted = await recordCommittedReceiptHf90(
      input,
      result,
    );
    return {
      ...result,
      exactOwnerBoundHf90: true,
      committedReceiptPersisted,
      externalWriteConfirmed: result?.committed === true,
      retrySafe: result?.committed === true ? false : result?.retrySafe,
      extensionVersion: VERSION_HF90,
    };
  }

  globalThis.__commerceOsHf84ExplicitPopupHandoff =
    explicitPopupHandoffHf90;

  if (globalThis.__COMMERCE_OS_EXPOSE_STOCK_HF90_TEST_HOOKS__ === true) {
    globalThis.__commerceOsStockHf90TestHooks = {
      exactPopupUrlHf90,
      expectedListTabHf90,
      bindExactPopupOwnerHf90,
      recordCommittedReceiptHf90,
      explicitPopupHandoffHf90,
    };
  }
})();
