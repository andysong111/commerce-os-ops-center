export type ShoplingStockLaunchMode = "PARALLEL" | "SINGLE";

type StockLaunchJob = {
  productKind: "OPTION" | "SINGLE";
};

const OPTION_FIRST_PARALLEL_MIN_VERSION = [0, 5, 8] as const;

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

/**
 * Keeps queue priority intact. HF28/HF29 can overlap only when Lane 1 is SINGLE;
 * HF30 can safely detach OPTION Lane 1 after its final A21 batch submission.
 */
export function planShoplingStockLaunch<T extends StockLaunchJob>(
  jobs: readonly T[],
  extensionVersion: string | null | undefined,
): { mode: ShoplingStockLaunchMode; jobs: T[]; compatibilitySerial: boolean } {
  const first = jobs[0];
  if (!first) return { mode: "SINGLE", jobs: [], compatibilitySerial: false };

  const firstTwo = jobs.slice(0, 2);
  const canUseParallel =
    firstTwo.length === 2 &&
    (first.productKind === "SINGLE" ||
      supportsOptionFirstParallel(extensionVersion));

  if (canUseParallel) {
    return { mode: "PARALLEL", jobs: firstTwo, compatibilitySerial: false };
  }

  return {
    mode: "SINGLE",
    jobs: [first],
    compatibilitySerial:
      firstTwo.length === 2 && first.productKind === "OPTION",
  };
}
