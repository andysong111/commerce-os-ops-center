import { confirmSourcingWarehouseReceipt } from "./sourcingReceiptBridge";
import { materializeSourcingLaunchItem } from "./sourcingLaunchMaterialization";
import { reconcileSourcingReceiptArtifacts } from "./sourcingReceiptLifecycleCore";

export async function ensureSourcingReceiptArtifacts(receiptId: string, committedRows: unknown[]) {
  return reconcileSourcingReceiptArtifacts(receiptId, committedRows, {
    ensureWarehouse: async (proof) => {
      const result = await confirmSourcingWarehouseReceipt({
        receiptId: proof.receiptId,
        barcode: proof.barcode,
        payload: {
          sourcingConfirmed: true,
          sourcingIntakeId: proof.intakeId,
          sourcingOutboxId: proof.outboxId,
          modelNo: proof.modelNumber,
          productName: proof.productName,
          saleOption: proof.saleOption,
          chinaOption: proof.chinaOption,
          supplierLink: proof.supplierLink,
        },
      });
      if (!result) throw new Error("SOURCING_RECEIPT_WAREHOUSE_ACK_REQUIRED");
      return result;
    },
    ensureLaunch: async (proof) => materializeSourcingLaunchItem(proof),
  });
}
