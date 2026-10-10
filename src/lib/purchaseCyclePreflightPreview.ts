import { unstable_cache } from "next/cache";
import { loadPurchaseCyclePreflight } from "@/lib/purchaseCyclePreflight";
import type { PurchasePreflightOptions } from "@/lib/purchaseCyclePreflightCore";

const PREVIEW_REVALIDATE_SECONDS = 60;
const PREVIEW_READER_TIMEOUT_MS = 6_000;

// The preview is read-only and Draft save performs its own uncached, pinned
// recheck. Reusing the same exact input for one minute makes browser refreshes
// fast without turning cached evidence into write authority.
const loadCachedPurchaseCyclePreflightPreview = unstable_cache(
  async (options: PurchasePreflightOptions) =>
    loadPurchaseCyclePreflight(options, {
      readerTimeoutMs: PREVIEW_READER_TIMEOUT_MS,
    }),
  ["purchase-cycle-preflight-preview-v1"],
  { revalidate: PREVIEW_REVALIDATE_SECONDS },
);

export async function loadPurchaseCyclePreflightPreview(
  options: PurchasePreflightOptions,
) {
  return loadCachedPurchaseCyclePreflightPreview(options);
}
