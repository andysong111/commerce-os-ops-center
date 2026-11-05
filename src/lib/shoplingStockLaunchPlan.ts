export type ShoplingStockLaunchMode = "PARALLEL" | "SINGLE";

type StockLaunchJob = {
  productKind: "OPTION" | "SINGLE";
};

const OPTION_FIRST_PARALLEL_MIN_VERSION = [0, 5, 8] as const;
const ALL_DATE_STOCK_SYNC_MIN_VERSION = [0, 6, 37] as const;

function versionParts(value: string | null | undefined) {
  const match = String(value || "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return [0, 0, 0] as const;
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
}

export function supportsOptionFirstParallel(
  extensionVersion: string | null | undefined,
) {
  const actual = versionParts(extensionVersion);
  for (let index = 0; index < OPTION_FIRST_PARALLEL_MIN_VERSION.length; index += 1) {
    if (actual[index] > OPTION_FIRST_PARALLEL_MIN_VERSION[index]) return true;
    if (actual[index] < OPTION_FIRST_PARALLEL_MIN_VERSION[index]) return false;
  }
  return true;
}

export function supportsAllDateStockSync(
  extensionVersion: string | null | undefined,
) {
  const actual = versionParts(extensionVersion);
  for (let index = 0; index < ALL_DATE_STOCK_SYNC_MIN_VERSION.length; index += 1) {
    if (actual[index] > ALL_DATE_STOCK_SYNC_MIN_VERSION[index]) return true;
    if (actual[index] < ALL_DATE_STOCK_SYNC_MIN_VERSION[index]) return false;
  }
  return true;
}

/**
 * Preserve queue priority and execute one B-code at a time. The UI removes each
 * terminal job and launches the next saved job independently, so one failed
 * B-code cannot suppress another. HF69 also classifies every goods key by its
 * live option count, so an old one-option split listing cannot be hidden inside
 * an option batch. HF70 binds each A21
 * write to the fresh popup opened by the exact current list tab and rejects
 * shared-row radio-label matches. HF71 restores the proven three-column top
 * radio locator only after exact adjacent-label checks and records bounded
 * diagnostics when the live Shopling layout still differs. HF72 keeps the
 * per-key classification but groups compatible goods keys into A21 batches of
 * at most 200 and completes each batch at Shopling's processing-screen boundary.
 */
export function planShoplingStockLaunch<T extends StockLaunchJob>(
  jobs: readonly T[],
  extensionVersion: string | null | undefined,
): { mode: ShoplingStockLaunchMode; jobs: T[]; compatibilitySerial: boolean } {
  void extensionVersion;
  const first = jobs[0];
  if (!first) return { mode: "SINGLE", jobs: [], compatibilitySerial: false };
  return {
    mode: "SINGLE",
    jobs: [first],
    compatibilitySerial: jobs.length > 1,
  };
}
