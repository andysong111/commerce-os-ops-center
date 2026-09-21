type RecordValue = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BCODE = /^B[A-Z]{2}\d+-\d+$/;
const object = (v: unknown): RecordValue => v !== null && typeof v === "object" && !Array.isArray(v) ? v as RecordValue : {};
const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
export type SourcingReceiptProof = {
  receiptId: string; intakeId: string; outboxId: string; barcode: string;
  modelNumber: string; productName: string; saleOption: string; chinaOption: string;
  supplierLink: string; sourceLineId: string; quantity: number; unitCostKrw: number;
  receivedAt: string;
};

// Only committed receipt rows may enter this runner. Validate the entire batch
// before touching another system; never reconstruct proof from today's draft.
export function sourcingReceiptProofs(receiptId: string, rows: unknown[]): SourcingReceiptProof[] {
  if (!UUID.test(receiptId)) throw new Error("SOURCING_RECEIPT_PROOF_ID_INVALID");
  const proofs: SourcingReceiptProof[] = [];
  const seen = new Set<string>();
  for (const value of rows) {
    const row = object(value), event = object(row.input_snapshot), result = object(row.result_snapshot);
    const payload = object(event.payload), sourcing = object(result.sourcing), cost = object(result.receiptCost);
    if (!Object.keys(sourcing).length) {
      if (payload.sourcingConfirmed === true) throw new Error("SOURCING_RECEIPT_PROOF_MISSING");
      continue;
    }
    const intakeId = text(sourcing.intakeId), outboxId = text(sourcing.outboxId);
    const barcode = text(result.barcode), modelNumber = text(sourcing.modelNumber);
    const quantity = Number(cost.quantity), unitCostKrw = Number(cost.unitCostKrw);
    if (!UUID.test(intakeId) || !UUID.test(outboxId) || !BCODE.test(barcode) ||
        !/^AAA\d{3,}(?:-\d+)?$/.test(modelNumber) || !text(sourcing.productName) ||
        result.receiptId !== receiptId || cost.receiptId !== receiptId ||
        payload.receiptId !== receiptId || event.barcode !== barcode || cost.barcode !== barcode ||
        cost.modelNumber !== modelNumber || !text(event.sourceLineId) ||
        !["RECEIVED", "PARTIALLY_RECEIVED"].includes(text(event.status)) ||
        !Number.isSafeInteger(quantity) || quantity < 1 || result.receivedNow !== quantity ||
        !Number.isSafeInteger(unitCostKrw) || unitCostKrw < 1 ||
        !Number.isFinite(Date.parse(text(cost.receivedAt)))) {
      throw new Error("SOURCING_RECEIPT_PROOF_MISMATCH");
    }
    if (seen.has(intakeId) || proofs.some(p => p.barcode === barcode)) {
      throw new Error("SOURCING_RECEIPT_PROOF_DUPLICATE");
    }
    seen.add(intakeId);
    proofs.push({ receiptId, intakeId, outboxId, barcode, modelNumber,
      productName: text(sourcing.productName), saleOption: text(sourcing.saleOption),
      chinaOption: text(sourcing.chinaOption), supplierLink: text(sourcing.supplierLink),
      sourceLineId: text(event.sourceLineId), quantity, unitCostKrw, receivedAt: text(cost.receivedAt) });
  }
  return proofs;
}

export async function reconcileSourcingReceiptArtifacts(
  receiptId: string,
  rows: unknown[],
  dependencies: {
    ensureWarehouse: (proof: SourcingReceiptProof) => Promise<{ intakeId: string; modelNumber: string; skuId: string }>;
    ensureLaunch: (proof: SourcingReceiptProof) => Promise<{ itemId: string; modelNumber: string }>;
  },
) {
  const proofs = sourcingReceiptProofs(receiptId, rows);
  let completed = 0;
  for (const proof of proofs) {
    const warehouse = await dependencies.ensureWarehouse(proof);
    if (warehouse.intakeId !== proof.intakeId || warehouse.modelNumber !== proof.modelNumber || !warehouse.skuId) {
      throw new Error("SOURCING_RECEIPT_WAREHOUSE_ACK_MISMATCH");
    }
    const launch = await dependencies.ensureLaunch(proof);
    if (launch.itemId !== proof.intakeId || launch.modelNumber !== proof.modelNumber) {
      throw new Error("SOURCING_RECEIPT_LAUNCH_ACK_MISMATCH");
    }
    completed += 1;
  }
  return { completed };
}
