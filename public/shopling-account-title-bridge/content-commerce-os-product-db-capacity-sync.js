(() => {
  "use strict";

  const STORAGE_KEY = "commerceOsShoplingProductDbCapacityV1";
  const LAST_SYNCED_KEY = "commerceOsShoplingProductDbCapacityLastSyncedV1";
  const READY_EVENT = "commerce-os-shopling-product-db-capacity-bridge-ready";
  const READY_ATTRIBUTE = "data-commerce-os-shopling-product-db-capacity-bridge-ready";
  const REQUEST_EVENT = "commerce-os-shopling-product-db-capacity-sync-request";
  const RESULT_EVENT = "commerce-os-shopling-product-db-capacity-sync-result";
  const MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const ACK_TIMEOUT_MS = 3_000;
  const MAX_RETRY_ATTEMPTS = 6;
  let pendingSnapshotId = "";
  let retryAttempts = 0;
  let retryTimer = 0;
  let ackTimer = 0;

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

  function eventDetail(event) {
    if (!event || typeof event !== "object") return null;
    if (typeof event.detail === "string") {
      try {
        const parsed = JSON.parse(event.detail);
        return parsed && typeof parsed === "object" ? parsed : null;
      } catch {
        return null;
      }
    }
    return event.detail && typeof event.detail === "object" ? event.detail : null;
  }

  function mainBridgeReady() {
    return document.documentElement?.getAttribute(READY_ATTRIBUTE) === "v1";
  }

  function scheduleSync(delayMs = 0) {
    window.clearTimeout(retryTimer);
    retryTimer = window.setTimeout(() => void syncStoredCapacity(), delayMs);
  }

  function scheduleRetry() {
    if (retryAttempts >= MAX_RETRY_ATTEMPTS) return;
    retryAttempts += 1;
    scheduleSync(Math.min(1_000 * retryAttempts, 5_000));
  }

  async function syncStoredCapacity() {
    if (!mainBridgeReady()) {
      scheduleRetry();
      return;
    }
    const stored = await readStorage([STORAGE_KEY, LAST_SYNCED_KEY]);
    const snapshot = stored[STORAGE_KEY];
    if (!snapshot || text(snapshot.source) !== "shopling-plan-dom-v1") return;
    const observedAt = Date.parse(text(snapshot.observedAt));
    if (!Number.isFinite(observedAt) || Date.now() - observedAt > MAX_AGE_MS) return;
    if (text(stored[LAST_SYNCED_KEY]) === text(snapshot.snapshotId)) return;
    const snapshotId = text(snapshot.snapshotId);
    if (!snapshotId || pendingSnapshotId === snapshotId) return;
    pendingSnapshotId = snapshotId;
    const payload = {
      snapshotId,
      source: "shopling-plan-dom-v1",
      observedAt: new Date(observedAt).toISOString(),
      maximumProductCodeCount: Number(snapshot.maximumProductCodeCount),
      usedProductCodeCount: Number(snapshot.usedProductCodeCount),
      evidence: {
        pathname: text(snapshot.evidence?.pathname).slice(0, 240),
        pageTitle: text(snapshot.evidence?.pageTitle).slice(0, 200),
      },
    };
    window.dispatchEvent(
      new CustomEvent(REQUEST_EVENT, {
        detail: JSON.stringify(payload),
      }),
    );
    window.clearTimeout(ackTimer);
    ackTimer = window.setTimeout(() => {
      if (pendingSnapshotId !== snapshotId) return;
      pendingSnapshotId = "";
      scheduleRetry();
    }, ACK_TIMEOUT_MS);
  }

  window.addEventListener(RESULT_EVENT, (event) => {
    const detail = eventDetail(event);
    const snapshotId = text(detail?.snapshotId);
    if (!snapshotId || snapshotId !== pendingSnapshotId) return;
    window.clearTimeout(ackTimer);
    pendingSnapshotId = "";
    if (detail?.ok) {
      retryAttempts = 0;
      void writeStorage({ [LAST_SYNCED_KEY]: snapshotId });
      return;
    }
    scheduleRetry();
  });

  window.addEventListener(READY_EVENT, () => {
    retryAttempts = 0;
    scheduleSync();
  });

  scheduleSync();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    retryAttempts = 0;
    scheduleSync();
  });
})();
