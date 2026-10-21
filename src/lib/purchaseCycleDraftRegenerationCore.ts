export type RegenerableDraftCommitment = {
  sourceRunId: string | null;
  barcode: string;
  openQuantity: number;
  status: string;
  orderedQuantity: number;
  receivedQuantity: number;
};

export type ManualDraftRevisionCommitment = RegenerableDraftCommitment & {
  latestPayload: unknown;
  note?: string;
};

export type ManualDraftRevisionQuantityOverride = {
  barcode: string;
  targetQuantity: number;
};

const BARCODE = /^B[A-Z]{2}\d+-\d+$/;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizedBarcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

export function assertDraftCanBeRegenerated<T extends RegenerableDraftCommitment>(
  rows: T[],
  expectedDraftId: string,
): T[] {
  const activeRows = rows.filter((row) => row.openQuantity > 0);
  const activeDraftIds = [
    ...new Set(
      activeRows
        .map((row) => row.sourceRunId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  if (
    !activeDraftIds.includes(expectedDraftId)
  ) {
    throw new Error("PURCHASE_DRAFT_REGENERATION_ACTIVE_DRAFT_CHANGED");
  }
  const unsafe = activeRows.find(
    (row) =>
      !row.sourceRunId ||
      row.status !== "RESERVED" ||
      row.orderedQuantity > 0 ||
      row.receivedQuantity > 0,
  );
  if (unsafe) {
    throw new Error(
      `PURCHASE_DRAFT_REGENERATION_ALREADY_PROGRESSING:${unsafe.barcode}`,
    );
  }
  return activeRows;
}

export function buildManualDraftRevision(
  rows: ManualDraftRevisionCommitment[],
  expectedDraftId: string,
  excludedBarcodes: string[],
  quantityOverrides: ManualDraftRevisionQuantityOverride[],
) {
  const activeRows = assertDraftCanBeRegenerated(rows, expectedDraftId);
  const activeByBarcode = new Map(
    activeRows.map((row) => [normalizedBarcode(row.barcode), row] as const),
  );
  const exclusions = excludedBarcodes.map(normalizedBarcode);
  const exclusionSet = new Set(exclusions);
  const normalizedOverrides = quantityOverrides.map((row) => ({
    barcode: normalizedBarcode(row.barcode),
    targetQuantity: Math.round(Number(row.targetQuantity)),
  }));
  const overrideByBarcode = new Map(
    normalizedOverrides.map((row) => [row.barcode, row.targetQuantity] as const),
  );
  if (
    exclusions.length !== exclusionSet.size ||
    exclusions.some((barcode) => !BARCODE.test(barcode) || !activeByBarcode.has(barcode)) ||
    normalizedOverrides.length !== overrideByBarcode.size ||
    normalizedOverrides.some(
      (row) =>
        !BARCODE.test(row.barcode) ||
        !activeByBarcode.has(row.barcode) ||
        exclusionSet.has(row.barcode) ||
        row.targetQuantity < 5 ||
        row.targetQuantity > 9_995 ||
        row.targetQuantity % 5 !== 0,
    )
  ) {
    throw new Error("PURCHASE_DRAFT_MANUAL_REVISION_TARGET_CHANGED");
  }

  const lines = activeRows
    .filter((row) => !exclusionSet.has(normalizedBarcode(row.barcode)))
    .map((row) => {
      const barcode = normalizedBarcode(row.barcode);
      const payload = object(row.latestPayload);
      const plannedQuantity = overrideByBarcode.get(barcode) ?? row.openQuantity;
      return {
        barcode,
        modelNo: text(payload.modelNo) || null,
        productName: text(payload.productName),
        plannedQuantity,
        stockSense: payload.stockSense === "OUT" ? "OUT" as const : "LOW" as const,
        referenceDemandQuantity: Math.max(
          0,
          Math.round(Number(payload.referenceDemandQuantity) || plannedQuantity),
        ),
        note: text(payload.operatorNote || row.note).slice(0, 300),
      };
    });
  if (lines.length < 1) {
    throw new Error("PURCHASE_DRAFT_MANUAL_REVISION_EMPTY");
  }

  return {
    lines,
    removedCount: activeRows.length - lines.length,
    changedCount: lines.filter((line) => {
      const previous = activeByBarcode.get(line.barcode);
      return Boolean(previous && previous.openQuantity !== line.plannedQuantity);
    }).length,
  };
}
