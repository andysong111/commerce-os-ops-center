import { unstable_cache } from "next/cache";
import { loadPurchaseCyclePreflight } from "@/lib/purchaseCyclePreflight";
import type { PurchasePreflightOptions } from "@/lib/purchaseCyclePreflightCore";
import {
  loadPurchaseStrategyState,
  purchaseStrategyCalculationRevision,
} from "@/lib/purchaseStrategyState";

const PREVIEW_REVALIDATE_SECONDS = 60;
const PREVIEW_CACHE_WINDOW_MS = 30_000;
const PREVIEW_READER_TIMEOUT_MS = 50_000;

// The preview is read-only and Draft save performs its own uncached, pinned
// recheck. Reusing the same exact input briefly makes browser refreshes fast.
// The 30-second window also bounds how long a transient source-read failure
// can survive an operator retry.
const loadCachedPurchaseCyclePreflightPreview = unstable_cache(
  async (
    options: PurchasePreflightOptions,
    purchaseStrategyRevision: string,
    previewWindow: number,
  ) => {
    // The revision participates in Next's argument cache key. The calculation
    // reloads and verifies the ledger itself. The time window prevents a
    // transient source-read failure from being served as stale evidence after
    // the operator retries the same purchase-run start.
    void purchaseStrategyRevision;
    void previewWindow;
    return loadPurchaseCyclePreflight(options, {
      readerTimeoutMs: PREVIEW_READER_TIMEOUT_MS,
    });
  },
  ["purchase-cycle-preflight-preview-v5-retry-window"],
  { revalidate: PREVIEW_REVALIDATE_SECONDS },
);

export async function loadPurchaseCyclePreflightPreview(
  options: PurchasePreflightOptions,
) {
  try {
    const revision = purchaseStrategyCalculationRevision(
      await loadPurchaseStrategyState(),
    );
    const previewWindow = Math.floor(Date.now() / PREVIEW_CACHE_WINDOW_MS);
    return loadCachedPurchaseCyclePreflightPreview(
      options,
      revision,
      previewWindow,
    );
  } catch {
    // Do not cache a strategy-read outage. The fresh loader will return its
    // normal blocked evidence, and the next request can recover immediately.
    return loadPurchaseCyclePreflight(options, {
      readerTimeoutMs: PREVIEW_READER_TIMEOUT_MS,
    });
  }
}
