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
  intakeId: string; receiptId?: string; outboxId?: string; phase?: "RESERVED" | "RECEIVED";
  barcode: string; modelNumber: string; productName: string;
  saleOption?: string; chinaOption?: string; supplierLink?: string; unitCostKrw?: number; sourceLineId?: string;
  receivedAt?: string;
};

export type SourcingReservedLaunchInput = Omit<
  SourcingLaunchMaterializationInput,
  "receiptId" | "phase"
> & { outboxId: string };

const RESERVED_NOTE = "신규소싱 확정 · 입고 대기";
const RECEIVED_NOTE = "신규소싱 입고확정 · 출시 준비";

function ownsSourcingIntake(item: R, intakeId: string) {
  const source = record(item.source);
  const intakeIds = Array.isArray(source.sourcingIntakeIds) ? source.sourcingIntakeIds.map(text) : [];
  const options = Array.isArray(item.orderOptions) ? item.orderOptions.map(record) : [];
  return text(item.id) === intakeId || text(source.sourcingIntakeId) === intakeId ||
    intakeIds.includes(intakeId) || options.some((option) => text(option.sourcingIntakeId) === intakeId);
}

function assertSameIdentity(item: R, intakeId: string, modelNumber: string) {
  if (text(item.modelNumber).toUpperCase() !== modelNumber || !ownsSourcingIntake(item, intakeId)) {
    throw new Error("SOURCING_LAUNCH_IDEMPOTENCY_CONFLICT");
  }
}

export async function materializeSourcingLaunchItem(input: SourcingLaunchMaterializationInput) {
  const intakeId = text(input.intakeId), receiptId = text(input.receiptId);
  const outboxId = text(input.outboxId);
  const lifecycleStatus = input.phase ?? (receiptId ? "RECEIVED" : "RESERVED");
  const barcode = text(input.barcode).toUpperCase(), modelNumber = text(input.modelNumber).toUpperCase();
  const productName = text(input.productName), saleOption = text(input.saleOption) || "단일옵션";
  if (
    !UUID.test(intakeId) ||
    (lifecycleStatus === "RECEIVED" && !UUID.test(receiptId)) ||
    (lifecycleStatus === "RESERVED" && !UUID.test(outboxId))
  ) throw new Error("SOURCING_LAUNCH_IDENTITY_INVALID");
  if (!/^B[A-Z]{2}\d+-\d+$/.test(barcode)) throw new Error("SOURCING_LAUNCH_BCODE_INVALID");
  if (!/^AAA\d{3,}(?:-\d+)?$/.test(modelNumber)) throw new Error("SOURCING_LAUNCH_MODEL_INVALID");
  if (!productName || productName.length > 240) throw new Error("SOURCING_LAUNCH_PRODUCT_NAME_REQUIRED");
  const config = getProductLaunchAdminConfig();
  if (!config.ok) throw new Error("SOURCING_LAUNCH_STORAGE_NOT_CONFIGURED");
  const identity = temporaryOpsIdentity();
  const workspace = await readProductLaunchNormalizedWorkspace(config.value, identity.userId);
  if (!workspace) throw new Error("SOURCING_LAUNCH_WORKSPACE_REQUIRED");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const stored = await readProductLaunchState(config.value, identity.userId);
    if (!stored || !Array.isArray(record(stored.state_payload).items) || !text(stored.updated_at)) {
      // A failed read must never be treated as an empty workspace.
      throw new Error("SOURCING_LAUNCH_STATE_UNAVAILABLE");
    }
    const current = record(stored.state_payload);
    const items = current.items as R[];
    const existingForIntake = items.find((item) => ownsSourcingIntake(item, intakeId));
    const existingForModel = items.find((item) => text(item.modelNumber).toUpperCase() === modelNumber);
    if (existingForIntake && existingForModel && text(existingForIntake.id) !== text(existingForModel.id)) {
      throw new Error("SOURCING_LAUNCH_IDEMPOTENCY_CONFLICT");
    }
    if (existingForIntake) assertSameIdentity(existingForIntake, intakeId, modelNumber);
    const existing = existingForIntake || existingForModel;
    const itemId = existing ? text(existing.id) : intakeId;
    const normalized = await readProductLaunchNormalizedItem(config.value, identity.userId, itemId);
    if (normalized && text(normalized.modelNumber).toUpperCase() !== modelNumber) {
      throw new Error("SOURCING_LAUNCH_IDEMPOTENCY_CONFLICT");
    }
    // Names, images, categories and even a later physical move are user data.
    // Replaying an intake must not overwrite an already-edited normalized item.
    const canonicalItem = normalized || existing;
    let item = canonicalItem;
    let state = current as ProductLaunchTrackerState;
    let sourceUpdatedAt = text(stored.updated_at);
    let stateChanged = false;
    const canonicalOptions = Array.isArray(canonicalItem?.orderOptions) ? canonicalItem.orderOptions.map(record) : [];
    const currentOption = canonicalOptions.find((option) => text(option.sourcingIntakeId) === intakeId) ||
      (canonicalItem && text(record(canonicalItem.source).sourcingIntakeId) === intakeId
        ? canonicalOptions.find((option) => text(option.barcode).toUpperCase() === barcode)
        : undefined);
    if (currentOption && text(currentOption.barcode).toUpperCase() !== barcode) {
      throw new Error("SOURCING_LAUNCH_IDEMPOTENCY_CONFLICT");
    }
    const barcodeOwner = items.find((candidate) => text(candidate.barcode).toUpperCase() === barcode ||
      (Array.isArray(candidate.orderOptions) && candidate.orderOptions.some((option) => text(record(option).barcode).toUpperCase() === barcode)));
    if (barcodeOwner && (!existing || text(barcodeOwner.id) !== text(existing.id) || !currentOption)) {
      throw new Error("SOURCING_LAUNCH_BCODE_ALREADY_EXISTS");
    }
    const supplierLink = text(input.supplierLink);
    if (supplierLink && !/^https:\/\//.test(supplierLink)) throw new Error("SOURCING_LAUNCH_SUPPLIER_LINK_INVALID");
    const now = new Date(Math.max(Date.now(), Date.parse(sourceUpdatedAt) + 1)).toISOString();
    const optionPayload = {
      id:"sourcing-option-"+intakeId,barcode,optionName:"옵션",saleOption,chinaOption:text(input.chinaOption),
      unitCostKrw:Math.max(0,Math.round(Number(input.unitCostKrw)||0)),baseSalePriceKrw:0,
      sourceOrderItemId:text(input.sourceLineId)||null,optionBarcodeIdentityKey:"B:"+barcode,optionBarcodeIdentityKind:"B_CODE",
      sourcingIntakeId:intakeId,outboxId:outboxId||null,receiptId:receiptId||null,lifecycleStatus,
    };
    if (!existing) {
      if (barcodeOwner) {
        throw new Error("SOURCING_LAUNCH_BCODE_ALREADY_EXISTS");
      }
      const links = supplierLink ? [supplierLink] : [];
      const trackerRowNumber = items.reduce((max, i) => Math.max(max, Number(i.trackerRowNumber) || 0), 0) + 1;
      item = canonicalItem || {
        id: intakeId, modelNumber, productName, barcode, warehouseLocation: barcode,
        source: {
          system:"commerce-os-sourcing-engine",sourcingIntakeId:intakeId,outboxId,
          sourcingIntakeIds:[intakeId],
          receiptId:receiptId||null,sourceLineId:text(input.sourceLineId),materializedAt:now,
          lifecycleStatus,receivedAt:lifecycleStatus==="RECEIVED"?(text(input.receivedAt)||now):null,
        },
        notes:lifecycleStatus==="RECEIVED"?RECEIVED_NOTE:RESERVED_NOTE,
        workBatch:lifecycleStatus==="RECEIVED"?"신규소싱입고":"신규소싱확정",
        trackerRowNumber,
        createdAt:now,updatedAt:now,
        updatedBy:lifecycleStatus==="RECEIVED"?"신규소싱 입고 자동등록":"신규소싱 확정 자동등록",
        archivedAt:null,
        stages:{detailPage:stage(),priceKeyword:stage(),shoplingUpload:stage(),marketRegistration:stage(),orderMapping:stage(),inventoryReflection:stage()},
        options:[saleOption],optionLabels:[saleOption],
        orderOptions:[optionPayload],
        chinaProductLinks:links,primaryChinaProductLink:supplierLink,
        detailPageSource:{urls:links,primaryUrl:supplierLink,pinnedIndex:links.length?0:null,source:"sourcing_inbound_auto",updatedAt:now},
      };
      state = withProductLaunchListSnapshot(normalizeNewProductLaunchState({...current,schemaVersion:3,items:[...items,item]}) as ProductLaunchTrackerState);
      stateChanged = true;
    } else if (!currentOption) {
      const source = record(canonicalItem?.source);
      const intakeIds = Array.isArray(source.sourcingIntakeIds) ? source.sourcingIntakeIds.map(text) : [text(source.sourcingIntakeId)].filter(Boolean);
      const links = Array.isArray(canonicalItem?.chinaProductLinks) ? canonicalItem.chinaProductLinks.map(text).filter(Boolean) : [];
      const optionNames = Array.isArray(canonicalItem?.options) ? canonicalItem.options.map(text).filter(Boolean) : [];
      const optionLabels = Array.isArray(canonicalItem?.optionLabels) ? canonicalItem.optionLabels.map(text).filter(Boolean) : [];
      if (supplierLink && !links.includes(supplierLink)) links.push(supplierLink);
      item = {
        ...canonicalItem,
        source: { ...source, sourcingIntakeIds: [...new Set([...intakeIds, intakeId])] },
        options: [...new Set([...optionNames, saleOption])],
        optionLabels: [...new Set([...optionLabels, saleOption])],
        orderOptions: [...canonicalOptions, optionPayload],
        chinaProductLinks: links,
        updatedAt: now,
        updatedBy: "신규소싱 옵션 자동등록",
      };
      state = withProductLaunchListSnapshot(normalizeNewProductLaunchState({
        ...current,
        schemaVersion: 3,
        items: items.map((value) => text(value.id) === itemId ? item : value),
      }) as ProductLaunchTrackerState);
      stateChanged = true;
    } else if (lifecycleStatus === "RECEIVED") {
      const source = record(canonicalItem?.source);
      const previousReceiptId = text(currentOption.receiptId) ||
        (text(source.sourcingIntakeId) === intakeId ? text(source.receiptId) : "");
      if (previousReceiptId && previousReceiptId !== receiptId) {
        throw new Error("SOURCING_LAUNCH_RECEIPT_IDEMPOTENCY_CONFLICT");
      }
      if (text(currentOption.lifecycleStatus) !== "RECEIVED" || previousReceiptId !== receiptId) {
        const orderOptions = Array.isArray(canonicalItem?.orderOptions)
          ? canonicalItem.orderOptions.map((value) => {
              const option = record(value);
              const matches = text(option.sourcingIntakeId) === intakeId ||
                (text(source.sourcingIntakeId) === intakeId && text(option.barcode).toUpperCase() === barcode);
              if (!matches) return value;
              const currentCost = Math.max(0, Math.round(Number(option.unitCostKrw) || 0));
              return {
                ...option,
                sourcingIntakeId:intakeId,
                outboxId:text(option.outboxId)||outboxId||null,
                receiptId,
                lifecycleStatus:"RECEIVED",
                unitCostKrw: currentCost || Math.max(0, Math.round(Number(input.unitCostKrw) || 0)),
              };
            })
          : canonicalItem?.orderOptions;
        item = {
          ...canonicalItem,
          source: text(source.sourcingIntakeId) === intakeId ? {
            ...source,outboxId:text(source.outboxId)||outboxId,receiptId,
            sourceLineId:text(source.sourceLineId)||text(input.sourceLineId),
            lifecycleStatus:"RECEIVED",receivedAt:text(input.receivedAt)||now,
          } : source,
          notes: text(source.sourcingIntakeId) === intakeId && text(canonicalItem?.notes) === RESERVED_NOTE ? RECEIVED_NOTE : canonicalItem?.notes,
          workBatch: text(source.sourcingIntakeId) === intakeId && text(canonicalItem?.workBatch) === "신규소싱확정" ? "신규소싱입고" : canonicalItem?.workBatch,
          orderOptions,
          updatedAt: now,
          updatedBy: "신규소싱 입고 자동등록",
        };
        state = withProductLaunchListSnapshot(normalizeNewProductLaunchState({
          ...current,
          schemaVersion: 3,
          items: items.map((value) => text(value.id) === itemId ? item : value),
        }) as ProductLaunchTrackerState);
        stateChanged = true;
      }
    }
    if (stateChanged) {
      const now = new Date(Math.max(Date.now(), Date.parse(sourceUpdatedAt) + 1)).toISOString();
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
    if (!normalized || stateChanged) {
      const result = await syncProductLaunchNormalizedChangedItems(config.value, identity, state, sourceUpdatedAt, [itemId]);
      if (result.synced === false) throw new Error("SOURCING_LAUNCH_NORMALIZED_PENDING");
    }
    const numbering = await fetch(`${config.value.supabaseUrl}/rest/v1/rpc/ensure_product_launch_item_option_barcode_nos`,{
      method:"POST",headers:createSupabaseAdminHeaders(config.value.secretKey),
      body:JSON.stringify({p_owner_id:identity.userId,p_item_id:itemId}),cache:"no-store",signal:AbortSignal.timeout(15000),
    });
    if (!numbering.ok) throw new Error("SOURCING_LAUNCH_OPTION_BARCODE_PENDING");
    const readback = await readProductLaunchNormalizedItem(config.value,identity.userId,itemId);
    if (!readback) throw new Error("SOURCING_LAUNCH_NORMALIZED_PENDING");
    assertSameIdentity(readback,intakeId,modelNumber);
    return {
      ok:true as const,itemId,modelNumber,barcode,
      lifecycleStatus,replayed:Boolean(existingForIntake||ownsSourcingIntake(normalized||{},intakeId)),
    };
  }
  throw new Error("SOURCING_LAUNCH_CONCURRENT_SAVE_RETRY");
}

export async function materializeSourcingReservedLaunchItem(
  input: SourcingReservedLaunchInput,
) {
  return materializeSourcingLaunchItem({ ...input, phase: "RESERVED" });
}
