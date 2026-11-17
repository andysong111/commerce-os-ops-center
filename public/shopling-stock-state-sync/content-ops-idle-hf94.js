(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const PING = "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF27";
  const STATUS = "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF27";
  const REQUEST = "STOCK_SYNC_GET_IDLE_STATUS_HF94";
  let probePromise = null;

  const post = (payload) =>
    window.postMessage(
      {
        ...payload,
        extensionVersion: VERSION,
        stockSyncChannel: "HF27",
        stockIdleProbe: "HF94_MINIMAL_IDLE_STATUS",
      },
      location.origin,
    );

  async function runProbe() {
    const response = await chrome.runtime
      .sendMessage({ type: REQUEST })
      .catch((error) => ({
        ok: false,
        idleConfirmed: false,
        code: "HF94_IDLE_STATUS_MESSAGE_FAILED",
        message: String(
          error?.message || error || "확장 백그라운드 응답이 없습니다.",
        ),
      }));
    if (!response?.ok) {
      post({
        type: STATUS,
        active: null,
        idleConfirmed: false,
        statusProbeOk: false,
        statusProbeCode: String(
          response?.code || "HF94_IDLE_STATUS_NO_RESPONSE",
        ),
        statusProbeError: String(
          response?.message || "확장 작업상태 응답이 없습니다.",
        ),
      });
      return;
    }
    post({
      type: STATUS,
      active: response.active ?? null,
      idleConfirmed: response.idleConfirmed === true,
      statusProbeOk: true,
      recoveredTerminalLock: response.recoveredTerminalLock === true,
    });
  }

  function probeIdle() {
    if (probePromise) return probePromise;
    probePromise = runProbe().finally(() => {
      probePromise = null;
    });
    return probePromise;
  }

  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.type !== PING
    ) {
      return;
    }
    void probeIdle();
  });

  void probeIdle();
})();
