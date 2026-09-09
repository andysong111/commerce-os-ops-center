(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_PARALLEL_START";
  const STATUS = "COMMERCE_OS_SHOPLING_STOCK_SYNC_PARALLEL_STATUS";
  const post = (payload) => window.postMessage({ ...payload, extensionVersion: VERSION }, location.origin);

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || typeof data !== "object" || data.type !== START) return;
    void chrome.runtime
      .sendMessage({
        type: "STOCK_SYNC_PARALLEL_START_V028",
        batchId: data.batchId,
        jobs: Array.isArray(data.jobs) ? data.jobs : [],
      })
      .then((response) => {
        post({
          type: STATUS,
          phase: response?.ok ? "PARALLEL_START_ACCEPTED" : "PARALLEL_START_REJECTED",
          ...response,
        });
      })
      .catch((error) => {
        post({
          type: STATUS,
          ok: false,
          phase: "PARALLEL_START_EXCEPTION",
          code: "HF28_OPS_PARALLEL_BRIDGE_EXCEPTION",
          message: String(error?.message || error || "HF28 병렬 통신 실패"),
        });
      });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "STOCK_SYNC_PARALLEL_STATUS") return;
    post({ type: STATUS, ...(message.payload || {}) });
  });
})();
