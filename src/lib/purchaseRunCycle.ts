const DATE_ONLY = /^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

// The legacy monthly purchase cycle covered sales through 2026-08-31.
// The first operator-started purchase run must therefore begin at 2026-09-01.
export const PURCHASE_RUN_LEGACY_CUTOVER_START_DATE = "2026-09-01";

export type PurchaseRunCycleBasis = {
  mode: "ON_DEMAND";
  cycleKey: string;
  cycleStartDate: string;
  previousCycleStartDate: string;
  revenueRangeStartDate: string;
  revenueRangeEndDate: string;
  bootstrap: boolean;
};

export type PurchaseRunDraftSummary = {
  draftId: string;
  createdAt: string;
  cycleMode?: "ON_DEMAND" | "MONTHLY_LEGACY" | null;
  cycleStartDate?: string | null;
  previousCycleStartDate?: string | null;
  cycleKey?: string | null;
  cycleBootstrap?: boolean;
  receiptConfirmedAt?: string | null;
  orderedQuantity: number;
  receivedQuantity: number;
  openQuantity: number;
};

function validDate(value: unknown) {
  const candidate = String(value ?? "").trim();
  if (!DATE_ONLY.test(candidate)) return "";
  const parsed = Date.parse(`${candidate}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === candidate
    ? candidate
    : "";
}

function shiftDate(date: string, days: number) {
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10);
}

export function seoulDateFromTimestamp(value: unknown) {
  const parsed = Date.parse(String(value ?? ""));
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed + SEOUL_OFFSET_MS).toISOString().slice(0, 10);
}

export function purchaseRunCycleKey(
  previousCycleStartDateInput: unknown,
  cycleStartDateInput: unknown,
) {
  const previousCycleStartDate = validDate(previousCycleStartDateInput);
  const cycleStartDate = validDate(cycleStartDateInput);
  if (!previousCycleStartDate || !cycleStartDate) {
    throw new Error("PURCHASE_RUN_CYCLE_DATE_INVALID");
  }
  if (previousCycleStartDate >= cycleStartDate) {
    throw new Error("PURCHASE_RUN_CYCLE_RANGE_EMPTY");
  }
  return `purchase-run:${previousCycleStartDate}:${cycleStartDate}`;
}

export function buildPurchaseRunCycleBasis(input: {
  previousCycleStartDate: unknown;
  cycleStartDate: unknown;
  bootstrap?: boolean;
}): PurchaseRunCycleBasis {
  const previousCycleStartDate = validDate(input.previousCycleStartDate);
  const cycleStartDate = validDate(input.cycleStartDate);
  const cycleKey = purchaseRunCycleKey(previousCycleStartDate, cycleStartDate);
  return {
    mode: "ON_DEMAND",
    cycleKey,
    cycleStartDate,
    previousCycleStartDate,
    revenueRangeStartDate: previousCycleStartDate,
    revenueRangeEndDate: shiftDate(cycleStartDate, -1),
    bootstrap: input.bootstrap === true,
  };
}

function startDate(draft: PurchaseRunDraftSummary) {
  return validDate(draft.cycleStartDate) || seoulDateFromTimestamp(draft.createdAt);
}

function previousBoundaryBefore(
  drafts: PurchaseRunDraftSummary[],
  currentStartDate: string,
  excludedDraftId: string | null,
) {
  const older = drafts
    .filter((draft) => draft.draftId !== excludedDraftId)
    // A legacy monthly record is not an on-demand run boundary. The monthly
    // system already covered sales through the fixed cutover date below.
    .filter((draft) => draft.cycleMode !== "MONTHLY_LEGACY")
    .map((draft) => ({
      start: startDate(draft),
      receiptComplete:
        Boolean(draft.receiptConfirmedAt && Number.isFinite(Date.parse(draft.receiptConfirmedAt))) &&
        draft.receivedQuantity > 0 &&
        draft.openQuantity === 0,
    }))
    // Only a fully received run closes the demand interval. An abandoned Draft
    // or an order still in transit must not discard sales from the next run.
    .filter((row) => row.receiptComplete && row.start && row.start < currentStartDate)
    .sort((left, right) => right.start.localeCompare(left.start));
  return older[0]?.start ? shiftDate(older[0].start, 1) : "";
}

function bootstrapBoundary(cycleStartDate: string) {
  return cycleStartDate > PURCHASE_RUN_LEGACY_CUTOVER_START_DATE
    ? PURCHASE_RUN_LEGACY_CUTOVER_START_DATE
    : shiftDate(cycleStartDate, -30);
}

/**
 * Determines the immutable sales/budget interval for an operator-started
 * purchase run. Recalculating a Draft keeps its original boundary. A new run
 * starts from the day after the most recent fully received run's calculation
 * start date. Drafts, ordered-only runs and unfinished receipts never close a
 * demand interval. When there is no older receipt-confirmed on-demand run,
 * the first migrated run starts at 2026-09-01 because the retired monthly
 * cycle already covered sales through 2026-08-31.
 */
export function inferPurchaseRunCycleBasis(input: {
  targetDate: unknown;
  drafts: PurchaseRunDraftSummary[];
  replaceDraftId?: string | null;
  startNewRun?: boolean;
}) {
  const targetDate = validDate(input.targetDate);
  if (!targetDate) throw new Error("PURCHASE_RUN_CYCLE_DATE_INVALID");
  const replaceDraftId = String(input.replaceDraftId ?? "").trim() || null;
  const replacement = replaceDraftId
    ? input.drafts.find((draft) => draft.draftId === replaceDraftId) ?? null
    : null;
  if (replaceDraftId && !replacement) {
    throw new Error("PURCHASE_RUN_CYCLE_REPLACEMENT_NOT_FOUND");
  }

  const replacementStartDate = replacement ? startDate(replacement) : "";
  if (input.startNewRun === true && replacement && targetDate <= replacementStartDate) {
    throw new Error("PURCHASE_RUN_CYCLE_NEW_RUN_DATE_INVALID");
  }
  const preserveReplacementBoundary = Boolean(replacement && input.startNewRun !== true);
  const cycleStartDate = preserveReplacementBoundary ? replacementStartDate : targetDate;
  if (!cycleStartDate) throw new Error("PURCHASE_RUN_CYCLE_DATE_INVALID");
  // Early migrated Drafts were saved with a rolling 30-day bootstrap. Repair
  // that boundary on recalculation instead of preserving the obsolete value.
  const explicitPrevious = preserveReplacementBoundary && replacement && !replacement.cycleBootstrap
    ? validDate(replacement.previousCycleStartDate)
    : "";
  const historicalPrevious = previousBoundaryBefore(
    input.drafts,
    cycleStartDate,
    replacement?.draftId ?? null,
  );
  const previousCycleStartDate = explicitPrevious || historicalPrevious || bootstrapBoundary(cycleStartDate);
  return buildPurchaseRunCycleBasis({
    previousCycleStartDate,
    cycleStartDate,
    bootstrap: !explicitPrevious && !historicalPrevious,
  });
}

export function isPurchaseRunCycleBasis(value: unknown): value is PurchaseRunCycleBasis {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  try {
    const normalized = buildPurchaseRunCycleBasis({
      previousCycleStartDate: row.previousCycleStartDate,
      cycleStartDate: row.cycleStartDate,
      bootstrap: row.bootstrap === true,
    });
    return row.mode === "ON_DEMAND" && row.cycleKey === normalized.cycleKey &&
      row.revenueRangeStartDate === normalized.revenueRangeStartDate &&
      row.revenueRangeEndDate === normalized.revenueRangeEndDate;
  } catch {
    return false;
  }
}
