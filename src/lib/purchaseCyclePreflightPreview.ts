import { unstable_cache } from "next/cache";
import { loadPurchaseCyclePreflight } from "@/lib/purchaseCyclePreflight";
import type { PurchasePreflightOptions } from "@/lib/purchaseCyclePreflightCore";
import {
  loadPurchaseStrategyState,
  purchaseStrategyCalculationRevision,
} from "@/lib/purchaseStrategyState";

const PREVIEW_REVALIDATE_SECONDS = 60;
const PREVIEW_READER_TIMEOUT_MS = 50_000;

// The preview is read-only and Draft save performs its own uncached, pinned
// recheck. Reusing the same exact input for one minute makes browser refreshes
// fast without turning cached evidence into write authority.
const loadCachedPurchaseCyclePreflightPreview = unstable_cache(
  async (
    options: PurchasePreflightOptions,
    purchaseStrategyRevision: string,
  ) => {
    // The revision participates in Next's argument cache key. The calculation
    // reloads and verifies the ledger itself; this value only prevents a saved
    // policy/status change from reusing the prior 60-second preview.
    void purchaseStrategyRevision;
    return loadPurchaseCyclePreflight(options, {
      readerTimeoutMs: PREVIEW_READER_TIMEOUT_MS,
    });
  },
  ["purchase-cycle-preflight-preview-v4-strategy-revision"],
  { revalidate: PREVIEW_REVALIDATE_SECONDS },
);

export async function loadPurchaseCyclePreflightPreview(
  options: PurchasePreflightOptions,
) {
  try {
    const revision = purchaseStrategyCalculationRevision(
      await loadPurchaseStrategyState(),
    );
    return loadCachedPurchaseCyclePreflightPreview(options, revision);
  } catch {
    // Do not cache a strategy-read outage. The fresh loader will return its
    // normal blocked evidence, and the next request can recover immediately.
    return loadPurchaseCyclePreflight(options, {
      readerTimeoutMs: PREVIEW_READER_TIMEOUT_MS,
    });
  }
}
