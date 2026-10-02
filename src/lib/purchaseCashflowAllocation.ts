export type PurchaseCashflowTier = "CORE" | "SUPPORT" | "CANARY";

export type PurchaseCashflowCandidate = {
  barcode: string;
  priorityScore: number;
  targetQuantity: number;
  unitCostKrw: number;
  moq?: number;
  cartonQuantity?: number;
};

export type PurchaseCashflowAllocation = Omit<
  PurchaseCashflowCandidate,
  "moq" | "cartonQuantity"
> & {
  moq: number;
  cartonQuantity: number;
  tier: PurchaseCashflowTier;
  minimumQuantity: number;
  baselineQuantity: number;
  allocatedQuantity: number;
  estimatedCostKrw: number;
  cashAdjusted: boolean;
};

const quantity = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
};

const roundUp = (value: number, unit: number) =>
  Math.max(0, Math.ceil(value / unit) * unit);

const roundDown = (value: number, unit: number) =>
  Math.max(0, Math.floor(value / unit) * unit);

function tierFor(index: number, count: number): PurchaseCashflowTier {
  const coreEnd = Math.max(1, Math.ceil(count * 0.25));
  const supportEnd = Math.max(coreEnd, Math.ceil(count * 0.75));
  if (index < coreEnd) return "CORE";
  if (index < supportEnd) return "SUPPORT";
  return "CANARY";
}

/**
 * Explicit cash caps use a three-tier allocation. Core rows keep the engine
 * target, support rows start at 60%, and canary rows start at one MOQ/carton
 * lot. Remaining cash tops rows up in priority order.
 */
export function allocatePurchaseCashflow(
  candidates: PurchaseCashflowCandidate[],
  productBudgetKrw: number,
): PurchaseCashflowAllocation[] {
  const budget = Math.max(0, Math.floor(Number(productBudgetKrw) || 0));
  const sorted = candidates
    .map((row) => ({ ...row }))
    .sort(
      (left, right) =>
        right.priorityScore - left.priorityScore ||
        left.unitCostKrw * left.targetQuantity -
          right.unitCostKrw * right.targetQuantity ||
        left.barcode.localeCompare(right.barcode),
    );

  const prepared: PurchaseCashflowAllocation[] = sorted.map((row, index) => {
    const targetQuantity = quantity(row.targetQuantity);
    const unitCostKrw = quantity(row.unitCostKrw);
    const cartonQuantity = Math.max(1, quantity(row.cartonQuantity) || 1);
    const moq = Math.max(1, quantity(row.moq) || 1);
    const minimumQuantity = Math.min(
      targetQuantity,
      roundUp(moq, cartonQuantity),
    );
    const tier = tierFor(index, sorted.length);
    const supportQuantity = Math.max(
      minimumQuantity,
      roundDown(Math.ceil(targetQuantity * 0.6), cartonQuantity),
    );
    const baselineQuantity =
      tier === "CORE"
        ? targetQuantity
        : tier === "SUPPORT"
          ? Math.min(targetQuantity, supportQuantity)
          : minimumQuantity;
    return {
      ...row,
      targetQuantity,
      unitCostKrw,
      moq,
      cartonQuantity,
      tier,
      minimumQuantity,
      baselineQuantity,
      allocatedQuantity: 0,
      estimatedCostKrw: 0,
      cashAdjusted: false,
    };
  });

  let remaining = budget;
  for (const row of prepared) {
    const baselineCost = row.baselineQuantity * row.unitCostKrw;
    const minimumCost = row.minimumQuantity * row.unitCostKrw;
    if (row.baselineQuantity > 0 && baselineCost <= remaining) {
      row.allocatedQuantity = row.baselineQuantity;
      remaining -= baselineCost;
    } else if (row.minimumQuantity > 0 && minimumCost <= remaining) {
      row.allocatedQuantity = row.minimumQuantity;
      remaining -= minimumCost;
    }
  }

  for (const row of prepared) {
    if (row.allocatedQuantity <= 0 || row.allocatedQuantity >= row.targetQuantity) {
      continue;
    }
    const affordable = Math.floor(remaining / row.unitCostKrw);
    const additional = Math.min(
      row.targetQuantity - row.allocatedQuantity,
      roundDown(affordable, row.cartonQuantity),
    );
    if (additional <= 0) continue;
    row.allocatedQuantity += additional;
    remaining -= additional * row.unitCostKrw;
  }

  return prepared.map((row) => ({
    ...row,
    estimatedCostKrw: row.allocatedQuantity * row.unitCostKrw,
    cashAdjusted:
      row.allocatedQuantity > 0 &&
      row.allocatedQuantity < row.targetQuantity,
  }));
}
