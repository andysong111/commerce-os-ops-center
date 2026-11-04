const DAY_MS = 24 * 60 * 60 * 1000;
const ANALYSIS_DAYS = 360;
const CLAIM_REFRESH_DAYS = 31;

export type ShoplingDateRange = {
  start: string;
  end: string;
};

export type DemandMappingIdentity = {
  key: string;
  barcode: string;
  unitsPerOrder: number;
};

export type PurchaseRunDemandCollectionPlan = {
  mode: "FULL_BASELINE" | "INCREMENTAL";
  orderRanges: ShoplingDateRange[];
  claimRanges: ShoplingDateRange[];
  orderStartDate: string;
  claimStartDate: string;
};

function validDate(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00.000Z`));
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function daysBefore(date: string, days: number) {
  return dateOnly(new Date(Date.parse(`${date}T00:00:00.000Z`) - days * DAY_MS));
}

function splitDateRange(start: string, end: string, maxInclusiveDays: number) {
  const ranges: ShoplingDateRange[] = [];
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  let cursorMs = Date.parse(`${start}T00:00:00.000Z`);
  while (cursorMs <= endMs) {
    const rangeEndMs = Math.min(
      endMs,
      cursorMs + (maxInclusiveDays - 1) * DAY_MS,
    );
    ranges.push({
      start: dateOnly(new Date(cursorMs)),
      end: dateOnly(new Date(rangeEndMs)),
    });
    cursorMs = rangeEndMs + DAY_MS;
  }
  return ranges;
}

export function buildPurchaseRunDemandCollectionPlan(input: {
  targetDate: string;
  previousPurchaseRunStartDate?: string | null;
  reusableLedgerAvailable: boolean;
}): PurchaseRunDemandCollectionPlan {
  if (!validDate(input.targetDate)) {
    throw new Error("PURCHASE_RUN_DEMAND_TARGET_DATE_INVALID");
  }
  const previous = input.previousPurchaseRunStartDate ?? null;
  const incremental = Boolean(
    input.reusableLedgerAvailable &&
    previous &&
    validDate(previous) &&
    previous <= input.targetDate,
  );
  const orderStartDate = incremental
    ? previous!
    : daysBefore(input.targetDate, ANALYSIS_DAYS);
  const claimStartDate = incremental
    ? daysBefore(input.targetDate, CLAIM_REFRESH_DAYS - 1)
    : daysBefore(input.targetDate, ANALYSIS_DAYS);
  return {
    mode: incremental ? "INCREMENTAL" : "FULL_BASELINE",
    orderRanges: splitDateRange(orderStartDate, input.targetDate, 7),
    claimRanges: splitDateRange(
      claimStartDate,
      input.targetDate,
      incremental ? CLAIM_REFRESH_DAYS : 90,
    ),
    orderStartDate,
    claimStartDate,
  };
}

export function demandMappingIdentitiesCompatible(
  previous: DemandMappingIdentity[],
  current: DemandMappingIdentity[],
) {
  if (!previous.length || !current.length) return false;
  const currentByKey = new Map(current.map((row) => [row.key, row]));
  for (const row of previous) {
    const next = currentByKey.get(row.key);
    // New listings and removed listings are safe for already-normalized ledger
    // events. Reusing a key for a different SKU or pack size is not.
    if (next && (next.barcode !== row.barcode || next.unitsPerOrder !== row.unitsPerOrder)) {
      return false;
    }
  }
  return true;
}

export function latestPriorPurchaseRunStartDate(
  drafts: Array<{ cycleStartDate?: string | null }>,
  targetDate: string,
) {
  return [...new Set(
    drafts
      .map((draft) => String(draft.cycleStartDate ?? "").trim())
      .filter((date) => validDate(date) && date < targetDate),
  )].sort().at(-1) ?? null;
}
