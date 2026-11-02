export type ShoplingStockLaunchMode = "PARALLEL" | "SINGLE";

type StockLaunchJob = {
  productKind: "OPTION" | "SINGLE";
};

const OPTION_FIRST_PARALLEL_MIN_VERSION = [0, 5, 8] as const;
const ALL_DATE_STOCK_SYNC_MIN_VERSION = [0, 6, 19] as const;

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
 * Keeps queue priority intact. HF28/HF29 can overlap only when Lane 1 is SINGLE;
 * HF30 can safely detach OPTION Lane 1 after its final A21 batch submission.
 */
export function planShoplingStockLaunch<T extends StockLaunchJob>(
  jobs: readonly T[],
  extensionVersion: string | null | undefined,
): { mode: ShoplingStockLaunchMode; jobs: T[]; compatibilitySerial: boolean } {
  void extensionVersion;
  const first = jobs[0];
  if (!first) return { mode: "SINGLE", jobs: [], compatibilitySerial: false };
  // Shopling exposes one shared stock-state worker. A live production batch
  // proved that launching lane 2 while lane 1 still owned that worker rejects
  // the second B-code. Dispatch one B-code at a time until its terminal result
  // is durably recorded; completeness is more important than overlap speed.
  return {
    mode: "SINGLE",
    jobs: [first],
    compatibilitySerial: jobs.length > 1,
  };
}
