importScripts("background-v057.js");

// HF14 SINGLE policy:
// A6 is the authoritative source of candidate goods keys for a B-code, but a candidate
// may have been deleted from Shopling before A21 transmission. The HF14 packaged A21
// worker therefore ignores only requested keys that are absent from the A21 result.
// This overlay records those ignored keys as evidence. It does not weaken the safety
// rule that every row actually returned by A21 must belong to the A6-derived key set.
(() => {
  const VERSION_V058 = chrome.runtime.getManifest().version;
  const CANONICAL_STAGE = "A21_STAGE";

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== CANONICAL_STAGE || String(message?.stage || "") !== "POPUP_OPENING") return;
    const missing = Array.isArray(message?.missingGoodsKeys)
      ? [...new Set(message.missingGoodsKeys.map((value) => norm(value)).filter((value) => /^\d+$/.test(value)))]
      : [];
    if (!missing.length || message?.missingGoodsKeysIgnored !== true) return;

    void (async () => {
      const active = await loadActive();
      if (!active || active.status !== "RUNNING" || active.job?.productKind !== "SINGLE" || active.stage !== "A21_LIST") return;
      if (String(message?.jobId || "") !== String(active.job?.jobId || "")) return;

      const prior = Array.isArray(active.singleIgnoredMissingGoodsKeys) ? active.singleIgnoredMissingGoodsKeys : [];
      active.singleIgnoredMissingGoodsKeys = [...new Set([...prior, ...missing])];
      await saveActive(active);
      await progress(
        active,
        `${active.job.barcode} · A21에서 삭제/미존재 goods key ${missing.length}건 무시 · 실제 조회된 ${Number(message?.selectedRowCount || 0)}개 행만 ${statusKorean(active.job.desiredStatus)} 송신`,
        {
          code: "SINGLE_A21_MISSING_REQUESTED_KEYS_IGNORED",
          missingGoodsKeys: missing,
          ignoredMissingGoodsKeysTotal: active.singleIgnoredMissingGoodsKeys,
          requestedGoodsKeyCount: Number(message?.requestedGoodsKeyCount || 0),
          matchedGoodsKeyCount: Number(message?.matchedGoodsKeyCount || 0),
          selectedRowCount: Number(message?.selectedRowCount || 0),
          totalResultCount: Number(message?.totalResultCount || 0),
          returnedRowsRestrictedToA6DerivedGoodsKeys: true,
          extensionVersion: VERSION_V058,
        },
      );
    })();
  });
})();
