(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const PAGE_REQUEST =
    "COMMERCE_OS_SHOPLING_STOCK_SYNC_SESSION_PREFLIGHT_REQUEST";
  const PAGE_RESULT =
    "COMMERCE_OS_SHOPLING_STOCK_SYNC_SESSION_PREFLIGHT_RESULT";
  const RUNTIME_REQUEST = "STOCK_SYNC_SESSION_PREFLIGHT_HF67";

  function post(payload) {
    window.postMessage(
      {
        ...payload,
        extensionVersion: VERSION,
        stockSyncChannel: "HF67",
      },
      location.origin,
    );
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || typeof data !== "object" || data.type !== PAGE_REQUEST) return;
    const requestId = String(data.requestId || "");
    void chrome.runtime
      .sendMessage({ type: RUNTIME_REQUEST })
      .then((response) =>
        post({
          type: PAGE_RESULT,
          requestId,
          ...(response || {
            ok: false,
            code: "SHOPLING_SESSION_PREFLIGHT_NO_RESPONSE_HF67",
            message: "Shopling 로그인과 A21 준비 점검 응답이 없습니다.",
          }),
        }),
      )
      .catch((error) =>
        post({
          type: PAGE_RESULT,
          requestId,
          ok: false,
          code: "SHOPLING_SESSION_PREFLIGHT_BRIDGE_FAILED_HF67",
          message: String(
            error?.message || error || "Shopling 로그인과 A21 준비 점검 통신 실패",
          ),
        }),
      );
  });
})();
