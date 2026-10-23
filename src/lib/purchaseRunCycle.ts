const DATE_ONLY = /^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

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
  cycleStartDate?: string | null;
  previousCycleStartDate?: string | null;
  cycleKey?: string | null;
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

function receiptConfirmedDate(draft: PurchaseRunDraftSummary) {
  if (draft.orderedQuantity <= 0 || draft.openQuantity > 0) return "";
  return seoulDateFromTimestamp(draft.receiptConfirmedAt);
}

function previousBoundaryBefore(
  drafts: PurchaseRunDraftSummary[],
  currentStartDate: string,
  excludedDraftId: string | null,
) {
  const older = drafts
    .filter((draft) => draft.draftId !== excludedDraftId)
    .map((draft) => ({
      draft,
      start: startDate(draft),
      receipt: receiptConfirmedDate(draft),
      executed: draft.orderedQuantity > 0 || draft.receivedQuantity > 0,
    }))
    .filter((row) => (row.receipt || row.start) < currentStartDate)
    .sort((left, right) =>
      Number(Boolean(right.receipt)) - Number(Boolean(left.receipt)) ||
      (right.receipt || right.start).localeCompare(left.receipt || left.start) ||
      Number(right.executed) - Number(left.executed),
    );
  return older[0]?.receipt || older[0]?.start || "";
}

/**
 * Determines the immutable sales/budget interval for an operator-started
 * purchase run. Recalculating a Draft keeps its original boundary. A new run
 * starts after the latest completed receipt when that evidence exists; legacy
 * ledgers without receipt timestamps fall back to the prior run start. A
 * 30-day bootstrap is used only when the ledger has no older purchase run.
 */
export function inferPurchaseRunCycleBasis(input: {
  targetDate: unknown;
  drafts: PurchaseRunDraftSummary[];
  replaceDraftId?: string | null;
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

  const cycleStartDate = replacement ? startDate(replacement) : targetDate;
  if (!cycleStartDate) throw new Error("PURCHASE_RUN_CYCLE_DATE_INVALID");
  const explicitPrevious = replacement
    ? validDate(replacement.previousCycleStartDate)
    : "";
  const historicalPrevious = previousBoundaryBefore(
    input.drafts,
    cycleStartDate,
    replacement?.draftId ?? null,
  );
  const previousCycleStartDate = explicitPrevious || historicalPrevious || shiftDate(cycleStartDate, -30);
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
