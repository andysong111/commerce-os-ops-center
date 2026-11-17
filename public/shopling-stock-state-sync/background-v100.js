importScripts("background-v099.js");

// HF94 adds a small, dedicated idle probe for Commerce OS. The legacy status
// response includes the complete active job and last result, and the page-side
// bridge previously swallowed any response failure after announcing READY.
// This probe returns only the ownership fields needed to decide whether the
// next B-code may start. It never clears a live RUNNING job unless an exact
// terminal receipt for that same job is already persisted.
(() => {
  const ACTIVE_KEY_HF94 = "commerceOsShoplingStockStateSyncV013";
  const LAST_RESULT_KEY_HF94 =
    "commerceOsShoplingStockStateSyncLastResultV013";
  const IDLE_STATUS_REQUEST_HF94 = "STOCK_SYNC_GET_IDLE_STATUS_HF94";

  const normHf94 = (value) =>
    String(value ?? "").normalize("NFKC").trim();

  function exactTerminalReceiptHf94(active, lastResult) {
    const activeJobId = normHf94(active?.job?.jobId);
    const resultJobId = normHf94(lastResult?.jobId);
    const outcome = normHf94(lastResult?.outcome).toUpperCase();
    const startedAt = Number(active?.startedAt || 0);
    const finishedAt = Number(lastResult?.finishedAt || 0);
    return (
      active?.status === "RUNNING" &&
      Boolean(activeJobId) &&
      activeJobId === resultJobId &&
      ["SUCCEEDED", "FAILED", "UNCERTAIN"].includes(outcome) &&
      startedAt > 0 &&
      finishedAt >= startedAt
    );
  }

  function minimalActiveHf94(active) {
    if (!active || normHf94(active.status).toUpperCase() !== "RUNNING") {
      return null;
    }
    return {
      status: "RUNNING",
      stage: normHf94(active.stage),
      startedAt: Number(active.startedAt || 0),
      updatedAt: Number(active.updatedAt || 0),
      job: {
        jobId: normHf94(active?.job?.jobId),
        barcode: normHf94(active?.job?.barcode),
      },
    };
  }

  async function readIdleStatusHf94() {
    const stored = await chrome.storage.local.get([
      ACTIVE_KEY_HF94,
      LAST_RESULT_KEY_HF94,
    ]);
    let active = stored[ACTIVE_KEY_HF94] || null;
    const lastResult = stored[LAST_RESULT_KEY_HF94] || null;
    let recoveredTerminalLock = false;
    if (exactTerminalReceiptHf94(active, lastResult)) {
      await chrome.storage.local.remove(ACTIVE_KEY_HF94);
      await chrome.alarms
        .clear("commerce-os-shopling-stock-state-watchdog-v020")
        .catch(() => null);
      active = null;
      recoveredTerminalLock = true;
    }
    const minimalActive = minimalActiveHf94(active);
    return {
      ok: true,
      idleConfirmed: minimalActive === null,
      active: minimalActive,
      recoveredTerminalLock,
      probe: "HF94_MINIMAL_IDLE_STATUS",
      extensionVersion: chrome.runtime.getManifest().version,
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== IDLE_STATUS_REQUEST_HF94) return;
    void readIdleStatusHf94()
      .then(sendResponse)
      .catch((error) =>
        sendResponse({
          ok: false,
          idleConfirmed: false,
          active: null,
          code: "HF94_IDLE_STATUS_READ_FAILED",
          message: normHf94(
            error?.message || error || "확장 작업상태 저장소를 읽지 못했습니다.",
          ),
          probe: "HF94_MINIMAL_IDLE_STATUS",
          extensionVersion: chrome.runtime.getManifest().version,
        }),
      );
    return true;
  });

  if (globalThis.__COMMERCE_OS_EXPOSE_STOCK_HF94_TEST_HOOKS__ === true) {
    globalThis.__commerceOsStockHf94TestHooks = {
      exactTerminalReceiptHf94,
      minimalActiveHf94,
      readIdleStatusHf94,
    };
  }
})();
