(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const PING = "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF27";
  const STATUS = "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS_HF27";
  const REQUEST = "STOCK_SYNC_GET_IDLE_STATUS_HF94";
  const REQUEST_TIMEOUT_MS = 2_000;
  let probePromise = null;

  const post = (payload) =>
    window.postMessage(
      {
        ...payload,
        extensionVersion: VERSION,
        stockSyncChannel: "HF27",
        stockIdleProbe: "HF95_FLAT_BACKGROUND_IDLE_STATUS",
      },
      location.origin,
    );

  function requestIdleStatus() {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(
        () =>
          finish({
            ok: false,
            idleConfirmed: false,
            code: "HF95_IDLE_STATUS_RESPONSE_TIMEOUT",
            message:
              "확장 백그라운드가 2초 안에 다음 작업 가능 상태를 응답하지 않았습니다.",
          }),
        REQUEST_TIMEOUT_MS,
      );
      try {
        chrome.runtime.sendMessage({ type: REQUEST }, (response) => {
          const lastError = chrome.runtime.lastError?.message || "";
          if (lastError) {
            finish({
              ok: false,
              idleConfirmed: false,
              code: "HF95_IDLE_STATUS_MESSAGE_FAILED",
              message: lastError,
            });
            return;
          }
          finish(
            response || {
              ok: false,
              idleConfirmed: false,
              code: "HF95_IDLE_STATUS_NO_RESPONSE",
              message: "확장 백그라운드 응답 본문이 없습니다.",
            },
          );
        });
      } catch (error) {
        finish({
          ok: false,
          idleConfirmed: false,
          code: "HF95_IDLE_STATUS_MESSAGE_EXCEPTION",
          message: String(
            error?.message || error || "확장 백그라운드 호출에 실패했습니다.",
          ),
        });
      }
    });
  }

  async function runProbe() {
    const response = await requestIdleStatus();
    if (!response?.ok) {
      post({
        type: STATUS,
        active: null,
        idleConfirmed: false,
        statusProbeOk: false,
        statusProbeCode: String(
          response?.code || "HF95_IDLE_STATUS_UNKNOWN_FAILURE",
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
