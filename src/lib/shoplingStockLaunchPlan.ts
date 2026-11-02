export type ShoplingStockLaunchMode = "PARALLEL" | "SINGLE";

type StockLaunchJob = {
  productKind: "OPTION" | "SINGLE";
};

const OPTION_FIRST_PARALLEL_MIN_VERSION = [0, 5, 8] as const;
const ALL_DATE_STOCK_SYNC_MIN_VERSION = [0, 6, 22] as const;

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
 * Keep queue priority intact and bound concurrency to the extension's proven
 * two-lane coordinator. HF59 terminates Commerce OS responsibility when the
 * exact owner popup starts Shopling's processing/result page, including the
 * same-popup evidence path. Foreign lanes' processing popups cannot satisfy a job.
 */
export function planShoplingStockLaunch<T extends StockLaunchJob>(
  jobs: readonly T[],
  extensionVersion: string | null | undefined,
): { mode: ShoplingStockLaunchMode; jobs: T[]; compatibilitySerial: boolean } {
  const first = jobs[0];
  if (!first) return { mode: "SINGLE", jobs: [], compatibilitySerial: false };
  if (jobs.length >= 2 && supportsAllDateStockSync(extensionVersion)) {
    return {
      mode: "PARALLEL",
      jobs: [jobs[0], jobs[1]],
      compatibilitySerial: false,
    };
  }
  return {
    mode: "SINGLE",
    jobs: [first],
    compatibilitySerial: jobs.length > 1,
  };
}
