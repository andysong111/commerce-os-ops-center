(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const PROGRESS = "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS";
  const HEARTBEAT = "STOCK_SYNC_HEARTBEAT_V070";

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || typeof data !== "object" || data.type !== PROGRESS) return;

    const jobId = String(data.jobId || data.job?.jobId || "");
    if (!jobId) return;
    const goodsKeyIndex = Number(data.goodsKeyIndex);

    void chrome.runtime.sendMessage({
      type: HEARTBEAT,
      jobId,
      stage: String(data.stage || ""),
      source: "OPS_PROGRESS",
      goodsKey: String(data.goodsKey || ""),
      goodsKeyIndex: Number.isFinite(goodsKeyIndex) ? goodsKeyIndex : null,
      at: Date.now(),
      version: VERSION,
    }).catch(() => null);
  });
})();
