export type PurchaseRunStartCandidate = {
  draftId: string;
  cycleStartDate: string;
  createdAt: string;
  updatedAt: string;
  orderedQuantity: number;
  receivedQuantity: number;
  openQuantity: number;
};

function latest<T extends PurchaseRunStartCandidate>(drafts: T[]) {
  return [...drafts].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.createdAt.localeCompare(left.createdAt),
  )[0] ?? null;
}

export function sameDayPurchaseRun<T extends PurchaseRunStartCandidate>(
  drafts: T[],
  targetDate: string,
) {
  return latest(drafts.filter((draft) =>
    draft.cycleStartDate === targetDate && draft.openQuantity > 0,
  ));
}

export function replaceablePriorPurchaseRun<T extends PurchaseRunStartCandidate>(
  drafts: T[],
  targetDate: string,
) {
  return latest(drafts.filter((draft) =>
    draft.cycleStartDate < targetDate &&
    draft.openQuantity > 0 &&
    draft.orderedQuantity === 0 &&
    draft.receivedQuantity === 0,
  ));
}
