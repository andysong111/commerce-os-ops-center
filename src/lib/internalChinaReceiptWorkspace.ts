import type { ChinaOrderCommitmentSnapshot } from "@/lib/chinaOrderLedger";
import type { MonthlyDraftDisplayMetadata } from "@/lib/monthlyPurchaseDraftDisplayMetadata";

export type InternalChinaReceiptWorkspaceLine = {
  barcode: string;
  modelNo: string;
  modelName: string;
  saleOption: string;
  imageUrl: string;
  orderedQuantity: number;
  receivedQuantity: number;
  openQuantity: number;
  status: string;
  ondolpassExpectedQuantity: number | null;
  ondolpassReceivedQuantity: number | null;
  ondolpassRowCount: number;
  ondolpassReceivedRowCount: number;
  ondolpassPendingRowCount: number;
  ondolpassDisposedRowCount: number;
  ondolpassShortageRowCount: number;
  ondolpassShortageQuantity: number;
  ondolpassOverageRowCount: number;
  ondolpassOverageQuantity: number;
  ondolpassMismatchCount: number;
  suggestedReceiptQuantity: number | null;
};

type ReceiptCommitment = Pick<
  ChinaOrderCommitmentSnapshot,
  | "barcode"
  | "orderedQuantity"
  | "receivedQuantity"
  | "cancelledQuantity"
  | "committedQuantity"
  | "openQuantity"
  | "status"
>;

type ReceiptDraftLine = {
  barcode: string;
  modelNo?: string;
  modelName?: string;
  saleOption?: string;
};

type ReceiptPurchaseLine = {
  barcode: string;
  quantity: number;
  goodsPaidCny: number;
  orderNumber: string;
  supplierLink: string;
  chinaOption: string;
  assigned: boolean;
};

type ReceiptPurchaseEvidence = {
  cycleMonth: string;
  orderCount: number;
  lineCount: number;
  actualOrderPaidCny: number;
  assignedLineCount: number;
  unassignedLineCount: number;
  lines: ReceiptPurchaseLine[];
};

type ReceiptBarcodeCompletionEvidence = {
  cycleMonth: string;
  itemCount: number;
  matchedItemCount: number;
  lines: Array<{
    barcode: string;
    quantity: number;
    modelNo?: string;
    modelName?: string;
    saleOption?: string;
    imageUrl?: string;
  }>;
};

type ReceiptObservation = {
  byBarcode: Array<{
    barcode: string;
    expectedQuantity: number;
    observedReceivedQuantity: number;
    rowCount: number;
    receivedRowCount: number;
    pendingRowCount: number;
    disposedRowCount: number;
    shortageRowCount: number;
    shortageQuantity: number;
    overageRowCount: number;
    overageQuantity: number;
    mismatchCount: number;
  }>;
};

export type InternalChinaReceiptOrderLine = {
  barcode: string;
  orderedQuantity: number;
  receivedQuantity: number;
  cancelledQuantity: number;
  openQuantity: number;
  status: string;
  recoveredFromPurchaseEvidence: boolean;
  ledgerOrderedQuantity: number;
  ledgerCancelledQuantity: number;
  modelNo: string;
  modelName: string;
  saleOption: string;
  imageUrl: string;
};

export type InternalChinaReceiptOrderEvidenceResult =
  | {
      ok: true;
      lines: InternalChinaReceiptOrderLine[];
      recoveredLegacyLineCount: number;
      cancelledReservationBarcodes: string[];
      error: null;
    }
  | {
      ok: false;
      lines: [];
      recoveredLegacyLineCount: 0;
      cancelledReservationBarcodes: [];
      error: string;
    };

const BARCODE = /^[A-Z]{3}\d+-\d+$/;

function barcode(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function positiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function validHttpUrl(value: unknown) {
  try {
    const url = new URL(text(value));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function failure(error: string): InternalChinaReceiptOrderEvidenceResult {
  return {
    ok: false,
    lines: [],
    recoveredLegacyLineCount: 0,
    cancelledReservationBarcodes: [],
    error,
  };
}

/**
 * Reconciles the normal ORDERED ledger with the older flow that stored exact
 * 1688 payment lines but did not write ORDERED events. The legacy path is only
 * accepted when the completed barcode job and every paid line/commitment match
 * exactly; otherwise receipt remains fail-closed.
 */
export function resolveInternalChinaReceiptOrderEvidence(input: {
  cycleMonth: string;
  commitments: ReceiptCommitment[];
  purchase: ReceiptPurchaseEvidence | null;
  barcodeCompletion: ReceiptBarcodeCompletionEvidence | null;
}): InternalChinaReceiptOrderEvidenceResult {
  const { cycleMonth, commitments, purchase, barcodeCompletion } = input;
  if (!commitments.length) return failure("CHINA_RECEIPT_DRAFT_NOT_FOUND");
  if (
    !barcodeCompletion ||
    barcodeCompletion.cycleMonth !== cycleMonth ||
    barcodeCompletion.itemCount <= 0 ||
    barcodeCompletion.matchedItemCount !== barcodeCompletion.itemCount
  ) {
    return failure("CHINA_RECEIPT_BARCODE_COMPLETION_REQUIRED");
  }
  if (
    !purchase ||
    purchase.cycleMonth !== cycleMonth ||
    purchase.orderCount <= 0 ||
    !positiveNumber(purchase.actualOrderPaidCny) ||
    purchase.lineCount !== purchase.lines.length
  ) {
    return failure("CHINA_RECEIPT_ACTUAL_ORDER_EVIDENCE_REQUIRED");
  }

  const validPurchaseBarcodes = new Set(
    purchase.lines.flatMap((line) => {
      const code = barcode(line.barcode);
      return line.assigned &&
        BARCODE.test(code) &&
        text(line.chinaOption) &&
        validHttpUrl(line.supplierLink)
        ? [code]
        : [];
    }),
  );
  if (
    barcodeCompletion.lines.length !== barcodeCompletion.itemCount ||
    !validPurchaseBarcodes.size
  ) {
    return failure("CHINA_RECEIPT_ACTUAL_ORDER_EVIDENCE_REQUIRED");
  }

  const purchaseQuantityByBarcode = new Map<string, number>();
  const completedDisplayByBarcode = new Map<
    string,
    { modelNo: string; modelName: string; saleOption: string; imageUrl: string }
  >();
  for (const line of barcodeCompletion.lines) {
    const code = barcode(line.barcode);
    const lineQuantity = positiveInteger(line.quantity);
    if (
      !BARCODE.test(code) ||
      lineQuantity <= 0 ||
      !validPurchaseBarcodes.has(code)
    ) {
      return failure("CHINA_RECEIPT_ACTUAL_ORDER_LINE_INVALID");
    }
    purchaseQuantityByBarcode.set(
      code,
      (purchaseQuantityByBarcode.get(code) ?? 0) + lineQuantity,
    );
    const current = completedDisplayByBarcode.get(code);
    completedDisplayByBarcode.set(code, {
      modelNo: current?.modelNo || text(line.modelNo),
      modelName: current?.modelName || text(line.modelName),
      saleOption: current?.saleOption || text(line.saleOption),
      imageUrl: current?.imageUrl || text(line.imageUrl),
    });
  }

  const commitmentByBarcode = new Map<string, ReceiptCommitment>();
  for (const commitment of commitments) {
    const code = barcode(commitment.barcode);
    if (!BARCODE.test(code) || commitmentByBarcode.has(code)) {
      return failure("CHINA_RECEIPT_COMMITMENT_IDENTITY_INVALID");
    }
    commitmentByBarcode.set(code, commitment);
  }
  let recoveredLegacyLineCount = 0;
  const lines: InternalChinaReceiptOrderLine[] = [];
  for (const [code, paidQuantity] of purchaseQuantityByBarcode) {
    const commitment = commitmentByBarcode.get(code);
    if (!commitment) {
      return failure("CHINA_RECEIPT_ACTUAL_ORDER_COMMITMENT_MISMATCH");
    }
    const ledgerOrderedQuantity = Math.max(
      commitment.committedQuantity,
      commitment.orderedQuantity,
      paidQuantity,
    );
    const ledgerCancelledQuantity = Math.max(
      commitment.cancelledQuantity,
      ledgerOrderedQuantity - paidQuantity,
    );
    if (ledgerCancelledQuantity > ledgerOrderedQuantity) {
      return failure("CHINA_RECEIPT_ACTUAL_ORDER_COMMITMENT_MISMATCH");
    }
    const recoveredFromPurchaseEvidence = commitment.orderedQuantity <= 0;
    const completedDisplay = completedDisplayByBarcode.get(code);
    if (recoveredFromPurchaseEvidence) recoveredLegacyLineCount += 1;
    lines.push({
      barcode: code,
      orderedQuantity: paidQuantity,
      receivedQuantity: commitment.receivedQuantity,
      cancelledQuantity: Math.max(
        0,
        ledgerCancelledQuantity - (ledgerOrderedQuantity - paidQuantity),
      ),
      openQuantity: Math.max(
        0,
        ledgerOrderedQuantity -
          commitment.receivedQuantity -
          ledgerCancelledQuantity,
      ),
      status: commitment.status,
      recoveredFromPurchaseEvidence,
      ledgerOrderedQuantity,
      ledgerCancelledQuantity,
      modelNo: completedDisplay?.modelNo ?? "",
      modelName: completedDisplay?.modelName ?? "",
      saleOption: completedDisplay?.saleOption ?? "",
      imageUrl: completedDisplay?.imageUrl ?? "",
    });
  }

  const cancelledReservationBarcodes: string[] = [];
  for (const [code, commitment] of commitmentByBarcode) {
    if (purchaseQuantityByBarcode.has(code)) continue;
    if (commitment.orderedQuantity > 0 || commitment.receivedQuantity > 0) {
      return failure("CHINA_RECEIPT_ACTUAL_ORDER_COMMITMENT_MISMATCH");
    }
    if (commitment.openQuantity > 0) {
      cancelledReservationBarcodes.push(code);
    }
  }

  return {
    ok: true,
    lines: lines.sort((left, right) => left.barcode.localeCompare(right.barcode)),
    recoveredLegacyLineCount,
    cancelledReservationBarcodes: cancelledReservationBarcodes.sort(),
    error: null,
  };
}

export function hasActualOrderForReceiptWorkspace(
  evidence: InternalChinaReceiptOrderEvidenceResult,
) {
  return evidence.ok && evidence.lines.some((row) => row.orderedQuantity > 0);
}

export function buildInternalChinaReceiptWorkspaceLines(
  orderLines: InternalChinaReceiptOrderLine[],
  draftLines: ReceiptDraftLine[],
  displayByBarcode: Record<string, MonthlyDraftDisplayMetadata>,
  observation: ReceiptObservation | null = null,
): InternalChinaReceiptWorkspaceLine[] {
  const draftByBarcode = new Map(
    draftLines.map((line) => [barcode(line.barcode), line] as const),
  );
  const observedByBarcode = new Map(
    (observation?.byBarcode ?? []).map((line) => [
      barcode(line.barcode),
      line,
    ] as const),
  );

  return orderLines.map((row) => {
    const code = barcode(row.barcode);
    const draftLine = draftByBarcode.get(code);
    const display = displayByBarcode[code];
    const observed = observedByBarcode.get(code);
    const suggestedReceiptQuantity = observed
      ? Math.max(
          0,
          observed.observedReceivedQuantity - row.receivedQuantity,
        )
      : null;
    return {
      barcode: code,
      modelNo: row.modelNo || display?.modelNo || draftLine?.modelNo || "",
      modelName: row.modelName || display?.modelName || draftLine?.modelName || "",
      saleOption:
        row.saleOption || display?.saleOption || draftLine?.saleOption || "",
      imageUrl: row.imageUrl || display?.imageUrl || "",
      orderedQuantity: row.orderedQuantity,
      receivedQuantity: row.receivedQuantity,
      openQuantity: row.openQuantity,
      status: row.status,
      ondolpassExpectedQuantity: observed?.expectedQuantity ?? null,
      ondolpassReceivedQuantity:
        observed?.observedReceivedQuantity ?? null,
      ondolpassRowCount: observed?.rowCount ?? 0,
      ondolpassReceivedRowCount: observed?.receivedRowCount ?? 0,
      ondolpassPendingRowCount: observed?.pendingRowCount ?? 0,
      ondolpassDisposedRowCount: observed?.disposedRowCount ?? 0,
      ondolpassShortageRowCount: observed?.shortageRowCount ?? 0,
      ondolpassShortageQuantity: observed?.shortageQuantity ?? 0,
      ondolpassOverageRowCount: observed?.overageRowCount ?? 0,
      ondolpassOverageQuantity: observed?.overageQuantity ?? 0,
      ondolpassMismatchCount: observed?.mismatchCount ?? 0,
      suggestedReceiptQuantity,
    };
  });
}
