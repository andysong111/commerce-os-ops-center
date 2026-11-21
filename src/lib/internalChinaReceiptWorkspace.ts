import type { ChinaOrderCommitmentSnapshot } from "@/lib/chinaOrderLedger";
import type { MonthlyDraftDisplayMetadata } from "@/lib/monthlyPurchaseDraftDisplayMetadata";

export type InternalChinaReceiptWorkspaceLine = {
  barcode: string;
  modelNo: string;
  modelName: string;
  saleOption: string;
  orderedQuantity: number;
  receivedQuantity: number;
  openQuantity: number;
  status: string;
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
  lines: Array<{ barcode: string; quantity: number }>;
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
    if (!commitment || commitment.receivedQuantity > paidQuantity) {
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
    if (
      commitment.receivedQuantity + ledgerCancelledQuantity >
      ledgerOrderedQuantity
    ) {
      return failure("CHINA_RECEIPT_ACTUAL_ORDER_COMMITMENT_MISMATCH");
    }
    const recoveredFromPurchaseEvidence = commitment.orderedQuantity <= 0;
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
): InternalChinaReceiptWorkspaceLine[] {
  const draftByBarcode = new Map(
    draftLines.map((line) => [barcode(line.barcode), line] as const),
  );

  return orderLines.map((row) => {
    const code = barcode(row.barcode);
    const draftLine = draftByBarcode.get(code);
    const display = displayByBarcode[code];
    return {
      barcode: code,
      modelNo: display?.modelNo || draftLine?.modelNo || "",
      modelName: display?.modelName || draftLine?.modelName || "",
      saleOption: display?.saleOption || draftLine?.saleOption || "",
      orderedQuantity: row.orderedQuantity,
      receivedQuantity: row.receivedQuantity,
      openQuantity: row.openQuantity,
      status: row.status,
    };
  });
}
