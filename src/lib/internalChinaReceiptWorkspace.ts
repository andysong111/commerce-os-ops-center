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
  | "openQuantity"
  | "status"
>;

type ReceiptDraftLine = {
  barcode: string;
  modelNo?: string;
  modelName?: string;
  saleOption?: string;
};

function barcode(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().toUpperCase();
}

export function hasActualOrderForReceiptWorkspace(
  commitments: ReceiptCommitment[],
) {
  return commitments.some((row) => row.orderedQuantity > 0);
}

export function buildInternalChinaReceiptWorkspaceLines(
  commitments: ReceiptCommitment[],
  draftLines: ReceiptDraftLine[],
  displayByBarcode: Record<string, MonthlyDraftDisplayMetadata>,
): InternalChinaReceiptWorkspaceLine[] {
  const draftByBarcode = new Map(
    draftLines.map((line) => [barcode(line.barcode), line] as const),
  );

  return commitments.flatMap((row) => {
    if (row.orderedQuantity <= 0) return [];
    const code = barcode(row.barcode);
    const draftLine = draftByBarcode.get(code);
    const display = displayByBarcode[code];
    return [
      {
        barcode: code,
        modelNo: display?.modelNo || draftLine?.modelNo || "",
        modelName: display?.modelName || draftLine?.modelName || "",
        saleOption: display?.saleOption || draftLine?.saleOption || "",
        orderedQuantity: row.orderedQuantity,
        receivedQuantity: row.receivedQuantity,
        openQuantity: row.openQuantity,
        status: row.status,
      },
    ];
  });
}
