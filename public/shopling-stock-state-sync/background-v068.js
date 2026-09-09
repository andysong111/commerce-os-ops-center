importScripts("background-v067.js");

// HF27: the SINGLE batch layer historically called finish(..., "SUCCESS", ...), while
// Commerce OS persists only STARTED | SUCCEEDED | FAILED | UNCERTAIN. Shopling execution
// and result-window cleanup can therefore succeed but the final Commerce OS POST fails with
// SHOPLING_STOCK_SYNC_STATE_INVALID. Normalize the legacy alias at the single finish choke
// point so every inherited path records the canonical outcome without touching the proven
// Shopling send/close flow.
(() => {
  const TAG_V068 = "[CommerceOS Stock HF27]";
  const legacyFinishV068 = finish;

  finish = async function finishV068(active, outcome, message, evidence = {}) {
    const rawOutcome = String(outcome || "").toUpperCase();
    const normalizedOutcome = rawOutcome === "SUCCESS" ? "SUCCEEDED" : outcome;
    if (rawOutcome === "SUCCESS") {
      console.log(TAG_V068, new Date().toISOString(), "normalize legacy outcome", {
        from: rawOutcome,
        to: normalizedOutcome,
        jobId: active?.job?.jobId || null,
        barcode: active?.job?.barcode || null,
      });
    }
    return legacyFinishV068(active, normalizedOutcome, message, {
      ...evidence,
      outcomeNormalization: rawOutcome === "SUCCESS" ? "SUCCESS_TO_SUCCEEDED_HF27" : null,
    });
  };
})();
