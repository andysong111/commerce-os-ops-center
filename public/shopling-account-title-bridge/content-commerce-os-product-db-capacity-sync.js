(() => {
  "use strict";

  const STORAGE_KEY = "commerceOsShoplingProductDbCapacityV1";
  const LAST_SYNCED_KEY = "commerceOsShoplingProductDbCapacityLastSyncedV1";
  const REQUEST_EVENT = "commerce-os-shopling-product-db-capacity-sync-request";
  const RESULT_EVENT = "commerce-os-shopling-product-db-capacity-sync-result";
  const MAX_AGE_MS = 24 * 60 * 60 * 1000;

  function text(value) {
    return String(value ?? "").normalize("NFKC").trim();
  }

  function readStorage(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => {
        void chrome.runtime.lastError;
        resolve(result || {});
      });
    });
  }

  function writeStorage(value) {
    return new Promise((resolve) => {
      chrome.storage.local.set(value, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    });
  }

  async function syncStoredCapacity() {
    const stored = await readStorage([STORAGE_KEY, LAST_SYNCED_KEY]);
    const snapshot = stored[STORAGE_KEY];
    if (!snapshot || text(snapshot.source) !== "shopling-plan-dom-v1") return;
    const observedAt = Date.parse(text(snapshot.observedAt));
    if (!Number.isFinite(observedAt) || Date.now() - observedAt > MAX_AGE_MS) return;
    if (text(stored[LAST_SYNCED_KEY]) === text(snapshot.snapshotId)) return;
    window.dispatchEvent(
      new CustomEvent(REQUEST_EVENT, {
        detail: {
          snapshotId: text(snapshot.snapshotId),
          source: "shopling-plan-dom-v1",
          observedAt: new Date(observedAt).toISOString(),
          maximumProductCodeCount: Number(snapshot.maximumProductCodeCount),
          usedProductCodeCount: Number(snapshot.usedProductCodeCount),
          evidence: {
            pathname: text(snapshot.evidence?.pathname).slice(0, 240),
            pageTitle: text(snapshot.evidence?.pageTitle).slice(0, 200),
          },
        },
      }),
    );
  }

  window.addEventListener(RESULT_EVENT, (event) => {
    const detail = event instanceof CustomEvent ? event.detail : null;
    if (!detail?.ok || !detail?.snapshotId) return;
    void writeStorage({ [LAST_SYNCED_KEY]: text(detail.snapshotId) });
  });

  void syncStoredCapacity();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncStoredCapacity();
  });
})();
