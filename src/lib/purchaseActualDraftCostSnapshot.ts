import { createHash } from "node:crypto";
import type { InternalChinaPurchaseDraft } from "./internalChinaPurchaseDraft";

export type PurchaseActualDraftCostLine = {
  barcode: string;
  unitPriceCny: number;
  freightPerUnitCny: number;
  unitCostKrw: number;
};

export type PurchaseActualDraftCostSnapshot = {
  draftId: string;
  readAt: string;
  savedAt: string | null;
  contentFingerprint: string;
  rows: PurchaseActualDraftCostLine[];
};

function decimal(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}
function canonicalRows(rows: PurchaseActualDraftCostLine[]) {
  return rows
    .map((row) => ({
      barcode: row.barcode,
      unitPriceCny: Math.round(row.unitPriceCny * 100) / 100,
      freightPerUnitCny: Math.round(row.freightPerUnitCny * 1_000_000) / 1_000_000,
      unitCostKrw: Math.ceil(row.unitCostKrw),
    }))
    .sort((left, right) => left.barcode.localeCompare(right.barcode));
}

export function buildPurchaseActualDraftCostSnapshot(
  draft: InternalChinaPurchaseDraft,
  readAt: string,
): PurchaseActualDraftCostSnapshot {
  const groups = new Map<string, { quantity: number; freightCny: number }>();
  for (const line of draft.lines) {
    const key = line.freightGroupId.trim() || `__${line.barcode}`;
    const current = groups.get(key) ?? { quantity: 0, freightCny: 0 };
    current.quantity += Math.max(0, Math.round(line.quantity));
    current.freightCny += decimal(line.domesticChinaFreightCny);
    groups.set(key, current);
  }

  const rows = canonicalRows(
    draft.lines.flatMap((line) => {
      const unitPriceCny = decimal(line.unitPriceCny);
      if (unitPriceCny <= 0 || line.quantity <= 0) return [];
      const key = line.freightGroupId.trim() || `__${line.barcode}`;
      const group = groups.get(key) ?? { quantity: line.quantity, freightCny: 0 };
      const freightPerUnitCny = group.quantity > 0
        ? group.freightCny / group.quantity
        : 0;
      return [{
        barcode: line.barcode,
        unitPriceCny,
        freightPerUnitCny,
        unitCostKrw: Math.ceil(
          (unitPriceCny + freightPerUnitCny) * draft.exchangeRateKrwPerCny,
        ),
      }];
    }),
  );
  const contentFingerprint = `sha256:${createHash("sha256")
    .update(JSON.stringify({
      draftId: draft.draftId,
      savedAt: draft.savedAt,
      exchangeRateKrwPerCny: draft.exchangeRateKrwPerCny,
      rows,
    }))
    .digest("hex")}`;
  return {
    draftId: draft.draftId,
    readAt,
    savedAt: draft.savedAt,
    contentFingerprint,
    rows,
  };
}
