import { temporaryOpsIdentity } from "@/lib/opsLoginBypass";
import { getProductLaunchAdminConfig, readProductLaunchState } from "@/lib/productLaunchTrackerServer";
import { readProductLaunchNormalizedItem, readProductLaunchNormalizedWorkspace, syncProductLaunchNormalizedChangedItems } from "@/lib/productLaunchTrackerNormalizedStore";
import { normalizeNewProductLaunchState } from "@/lib/productLaunchOptionNames";
import { withProductLaunchListSnapshot } from "@/lib/productLaunchTrackerListSnapshot";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import type { ProductLaunchTrackerState } from "@/lib/productLaunchTrackerOptimized";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type R = Record<string, unknown>;
const text = (v: unknown) => String(v ?? "").normalize("NFKC").trim();
const record = (v: unknown): R => v !== null && typeof v === "object" && !Array.isArray(v) ? v as R : {};
const stage = () => ({status:"미시작",assignee:"",note:"",completedAt:null});
export type SourcingLaunchMaterializationInput = {
  intakeId: string; receiptId: string; barcode: string; modelNumber: string; productName: string;
  saleOption?: string; chinaOption?: string; supplierLink?: string; unitCostKrw?: number; sourceLineId?: string;
};

function assertSameIdentity(item: R, intakeId: string, modelNumber: string) {
  if (text(item.id) !== intakeId || text(item.modelNumber) !== modelNumber ||
      text(record(item.source).sourcingIntakeId) !== intakeId) {
    throw new Error("SOURCING_LAUNCH_IDEMPOTENCY_CONFLICT");
  }
}

export async function materializeSourcingLaunchItem(input: SourcingLaunchMaterializationInput) {
  const intakeId = text(input.intakeId), receiptId = text(input.receiptId);
  const barcode = text(input.barcode).toUpperCase(), modelNumber = text(input.modelNumber).toUpperCase();
  const productName = text(input.productName), saleOption = text(input.saleOption) || "단일옵션";
  if (!UUID.test(intakeId) || !UUID.test(receiptId)) throw new Error("SOURCING_LAUNCH_IDENTITY_INVALID");
  if (!/^B[A-Z]{2}\d+-\d+$/.test(barcode)) throw new Error("SOURCING_LAUNCH_BCODE_INVALID");
  if (!/^AAA\d{3,}(?:-\d+)?$/.test(modelNumber)) throw new Error("SOURCING_LAUNCH_MODEL_INVALID");
  if (!productName || productName.length > 240) throw new Error("SOURCING_LAUNCH_PRODUCT_NAME_REQUIRED");
  const config = getProductLaunchAdminConfig();
  if (!config.ok) throw new Error("SOURCING_LAUNCH_STORAGE_NOT_CONFIGURED");
  const identity = temporaryOpsIdentity();
  const workspace = await readProductLaunchNormalizedWorkspace(config.value, identity.userId);
  if (!workspace) throw new Error("SOURCING_LAUNCH_WORKSPACE_REQUIRED");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const [stored, normalized] = await Promise.all([
      readProductLaunchState(config.value, identity.userId),
      readProductLaunchNormalizedItem(config.value, identity.userId, intakeId),
    ]);
    if (!stored || !Array.isArray(record(stored.state_payload).items) || !text(stored.updated_at)) {
      // A failed read must never be treated as an empty workspace.
      throw new Error("SOURCING_LAUNCH_STATE_UNAVAILABLE");
    }
    const current = record(stored.state_payload);
    const items = current.items as R[];
    const existing = items.find(i => text(i.id) === intakeId);
    if (existing) assertSameIdentity(existing, intakeId, modelNumber);
    if (normalized) assertSameIdentity(normalized, intakeId, modelNumber);
    // Names, images, categories and even a later physical move are user data.
    // Replaying an intake must not overwrite an already-edited normalized item.
    const canonicalItem = normalized || existing;
    let item = canonicalItem;
    let state = current as ProductLaunchTrackerState;
    let sourceUpdatedAt = text(stored.updated_at);
    if (!existing) {
      if (items.some(i => text(i.modelNumber).toUpperCase() === modelNumber)) throw new Error("SOURCING_LAUNCH_MODEL_ALREADY_EXISTS");
      if (items.some(i => text(i.barcode).toUpperCase() === barcode ||
          (Array.isArray(i.orderOptions) && i.orderOptions.some(o => text(record(o).barcode).toUpperCase() === barcode)))) {
        throw new Error("SOURCING_LAUNCH_BCODE_ALREADY_EXISTS");
      }
      const now = new Date(Math.max(Date.now(), Date.parse(sourceUpdatedAt) + 1)).toISOString();
      const supplierLink = text(input.supplierLink);
      if (supplierLink && !/^https:\/\//.test(supplierLink)) throw new Error("SOURCING_LAUNCH_SUPPLIER_LINK_INVALID");
      const links = supplierLink ? [supplierLink] : [];
      const trackerRowNumber = items.reduce((max, i) => Math.max(max, Number(i.trackerRowNumber) || 0), 0) + 1;
      item = canonicalItem || {
        id: intakeId, modelNumber, productName, barcode, warehouseLocation: barcode,
        source: {system:"commerce-os-sourcing-engine",sourcingIntakeId:intakeId,receiptId,sourceLineId:text(input.sourceLineId),materializedAt:now},
        notes:"신규소싱 입고확정 후 Commerce OS 자동등록", workBatch:"신규소싱입고", trackerRowNumber,
        createdAt:now,updatedAt:now,updatedBy:"신규소싱 입고 자동등록",archivedAt:null,
        stages:{detailPage:stage(),priceKeyword:stage(),shoplingUpload:stage(),marketRegistration:stage(),orderMapping:stage(),inventoryReflection:stage()},
        options:[saleOption],optionLabels:[saleOption],
        orderOptions:[{id:"sourcing-option-"+intakeId,barcode,optionName:"옵션",saleOption,chinaOption:text(input.chinaOption),
          unitCostKrw:Math.max(0,Math.round(Number(input.unitCostKrw)||0)),baseSalePriceKrw:0,
          sourceOrderItemId:text(input.sourceLineId)||null,optionBarcodeIdentityKey:"B:"+barcode,optionBarcodeIdentityKind:"B_CODE"}],
        chinaProductLinks:links,primaryChinaProductLink:supplierLink,
        detailPageSource:{urls:links,primaryUrl:supplierLink,pinnedIndex:links.length?0:null,source:"sourcing_inbound_auto",updatedAt:now},
      };
      state = withProductLaunchListSnapshot(normalizeNewProductLaunchState({...current,schemaVersion:3,items:[...items,item]}) as ProductLaunchTrackerState);
      const params = new URLSearchParams({owner_id:`eq.${identity.userId}`,updated_at:`eq.${sourceUpdatedAt}`});
      const response = await fetch(`${config.value.supabaseUrl}/rest/v1/product_launch_tracker_states?${params}`,{
        method:"PATCH",headers:{...createSupabaseAdminHeaders(config.value.secretKey),Prefer:"return=representation"},
        body:JSON.stringify({state_payload:state,schema_version:3,updated_at:now}),cache:"no-store",signal:AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("SOURCING_LAUNCH_COMPARE_SWAP_FAILED");
      const rows: unknown = await response.json();
      if (!Array.isArray(rows)) throw new Error("SOURCING_LAUNCH_WRITE_ACK_INVALID");
      if (!rows.length) continue; // A concurrent save won; re-read, merge and retry.
      if (rows.length !== 1) throw new Error("SOURCING_LAUNCH_WRITE_ACK_INVALID");
      state = record(record(rows[0]).state_payload) as ProductLaunchTrackerState;
      sourceUpdatedAt = text(record(rows[0]).updated_at);
    }
    if (!normalized) {
      const result = await syncProductLaunchNormalizedChangedItems(config.value, identity, state, sourceUpdatedAt, [intakeId]);
      if (result.synced === false) throw new Error("SOURCING_LAUNCH_NORMALIZED_PENDING");
    }
    const numbering = await fetch(`${config.value.supabaseUrl}/rest/v1/rpc/ensure_product_launch_item_option_barcode_nos`,{
      method:"POST",headers:createSupabaseAdminHeaders(config.value.secretKey),
      body:JSON.stringify({p_owner_id:identity.userId,p_item_id:intakeId}),cache:"no-store",signal:AbortSignal.timeout(15000),
    });
    if (!numbering.ok) throw new Error("SOURCING_LAUNCH_OPTION_BARCODE_PENDING");
    const readback = await readProductLaunchNormalizedItem(config.value,identity.userId,intakeId);
    if (!readback) throw new Error("SOURCING_LAUNCH_NORMALIZED_PENDING");
    assertSameIdentity(readback,intakeId,modelNumber);
    return {ok:true as const,itemId:intakeId,modelNumber,barcode:text(readback.barcode),replayed:Boolean(existing||normalized)};
  }
  throw new Error("SOURCING_LAUNCH_CONCURRENT_SAVE_RETRY");
}
