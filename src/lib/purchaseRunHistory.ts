import { seoulDateFromTimestamp } from "./purchaseRunCycle.ts";

export type PurchaseRunHistorySource = {
  draftId: string;
  createdAt: string;
  cycleStartDate: string;
  previousCycleStartDate: string | null;
  receiptConfirmedAt?: string | null;
  lineCount: number;
  requestedQuantity: number;
  orderedQuantity: number;
  receivedQuantity: number;
  cancelledQuantity: number;
  openQuantity: number;
  updatedAt: string;
};

export type PurchaseRunHistoryItem = PurchaseRunHistorySource & {
  receiptConfirmedDate: string | null;
  state: "DRAFT" | "ORDERED" | "RECEIVING" | "RECEIVED" | "RELEASED";
  stateLabel: string;
};

export type ReleasedPurchaseRunGroup = {
  cycleStartDate: string;
  runs: PurchaseRunHistoryItem[];
};

function stateOf(draft: PurchaseRunHistorySource): PurchaseRunHistoryItem["state"] {
  if (draft.receivedQuantity > 0 && draft.openQuantity === 0) return "RECEIVED";
  if (draft.receivedQuantity > 0 && draft.openQuantity > 0) return "RECEIVING";
  if (
    draft.receivedQuantity === 0 &&
    draft.openQuantity === 0 &&
    draft.cancelledQuantity >= draft.orderedQuantity
  ) return "RELEASED";
  if (draft.orderedQuantity > 0) return "ORDERED";
  if (draft.openQuantity > 0) return "DRAFT";
  return "RELEASED";
}

function labelOf(state: PurchaseRunHistoryItem["state"]) {
  if (state === "RECEIVED") return "입고확정";
  if (state === "RECEIVING") return "부분입고";
  if (state === "ORDERED") return "입고대기";
  if (state === "DRAFT") return "주문초안";
  return "해제·종료";
}

export function buildPurchaseRunHistory(
  drafts: PurchaseRunHistorySource[],
): PurchaseRunHistoryItem[] {
  return drafts
    .map((draft) => {
      const state = stateOf(draft);
      const receiptConfirmedDate = state === "RECEIVED"
        ? seoulDateFromTimestamp(draft.receiptConfirmedAt)
        : "";
      return {
        ...draft,
        receiptConfirmedDate: receiptConfirmedDate || null,
        state,
        stateLabel: labelOf(state),
      };
    })
    .sort((left, right) => {
      const leftActive = left.state === "DRAFT" || left.state === "ORDERED" || left.state === "RECEIVING";
      const rightActive = right.state === "DRAFT" || right.state === "ORDERED" || right.state === "RECEIVING";
      return Number(rightActive) - Number(leftActive) ||
        (right.receiptConfirmedDate || right.cycleStartDate).localeCompare(
          left.receiptConfirmedDate || left.cycleStartDate,
        ) ||
        right.updatedAt.localeCompare(left.updatedAt);
    });
}

export function selectPurchaseRun(
  history: PurchaseRunHistoryItem[],
  requestedDraftId: unknown,
) {
  const requested = String(requestedDraftId ?? "").trim();
  return history.find((row) => row.draftId === requested) ?? history[0] ?? null;
}

export function groupPurchaseRunHistory(history: PurchaseRunHistoryItem[]) {
  const visibleRuns: PurchaseRunHistoryItem[] = [];
  const releasedByDate = new Map<string, PurchaseRunHistoryItem[]>();

  for (const run of history) {
    if (run.state !== "RELEASED") {
      visibleRuns.push(run);
      continue;
    }

    const group = releasedByDate.get(run.cycleStartDate) ?? [];
    group.push(run);
    releasedByDate.set(run.cycleStartDate, group);
  }

  const releasedGroups: ReleasedPurchaseRunGroup[] = Array.from(
    releasedByDate,
    ([cycleStartDate, runs]) => ({ cycleStartDate, runs }),
  ).sort((left, right) => right.cycleStartDate.localeCompare(left.cycleStartDate));

  return {
    visibleRuns,
    releasedGroups,
    releasedCount: releasedGroups.reduce((sum, group) => sum + group.runs.length, 0),
  };
}

