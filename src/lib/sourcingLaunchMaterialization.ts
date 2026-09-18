import { temporaryOpsIdentity } from "@/lib/opsLoginBypass";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  writeProductLaunchState,
} from "@/lib/productLaunchTrackerServer";
import {
  syncProductLaunchNormalizedChangedItems,
  syncProductLaunchNormalizedFull,
} from "@/lib/productLaunchTrackerNormalizedStore";
import type { ProductLaunchTrackerState } from "@/lib/productLaunchTrackerOptimized";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BARCODE = /^[A-Z]{3}\d+-\d+$/;
const MODEL_NO = /^AAA\d{3,}(?:-\d+)?$/i;

type RecordLike = Record<string, unknown>;

export type SourcingLaunchMaterializationInput = {
  intakeId: string;
  receiptId: string;
  barcode: string;
  modelNumber: string;
  productName: string;
  saleOption?: string;
  chinaOption?: string;
  supplierLink?: string;
  unitCostKrw?: number;
  sourceLineId?: string;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}
function record(value: unknown): RecordLike {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordLike)
    : {};
}
function stage() {
  return { status: "미시작", assignee: "", note: "", completedAt: null };
}
function normalizedUrl(value: unknown) {
  const candidate = text(value);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}
function positiveWon(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

export async function materializeSourcingLaunchItem(
  input: SourcingLaunchMaterializationInput,
) {
  const intakeId = text(input.intakeId).toLowerCase();
  const receiptId = text(input.receiptId).toLowerCase();
  const barcode = text(input.barcode).toUpperCase().replace(/\s+/g, "");
  const modelNumber = text(input.modelNumber).toUpperCase();
  const productName = text(input.productName).slice(0, 240);
  const saleOption = text(input.saleOption).slice(0, 200) || "단일옵션";
  const chinaOption = text(input.chinaOption).slice(0, 500);
  const supplierLink = normalizedUrl(input.supplierLink);
  const unitCostKrw = positiveWon(input.unitCostKrw);
  const sourceLineId = text(input.sourceLineId).slice(0, 240);

  if (!UUID.test(intakeId) || !UUID.test(receiptId)) {
    throw new Error("SOURCING_LAUNCH_IDENTITY_INVALID");
  }
  if (!BARCODE.test(barcode)) throw new Error("SOURCING_LAUNCH_BCODE_INVALID");
  if (!MODEL_NO.test(modelNumber)) throw new Error("SOURCING_LAUNCH_MODEL_INVALID");
  if (!productName) throw new Error("SOURCING_LAUNCH_PRODUCT_NAME_REQUIRED");

  const config = getProductLaunchAdminConfig();
  if (!config.ok) throw new Error("SOURCING_LAUNCH_STORAGE_NOT_CONFIGURED");
  const identity = temporaryOpsIdentity();
  const stored = await readProductLaunchState(config.value, identity.userId);
  const current = record(stored?.state_payload);
  const items = Array.isArray(current.items)
    ? current.items.filter((value): value is RecordLike => Boolean(value && typeof value === "object" && !Array.isArray(value)))
    : [];

  const existing = items.find((item) => text(item.id).toLowerCase() === intakeId);
  if (existing) {
    if (
      text(existing.modelNumber).toUpperCase() !== modelNumber ||
      text(existing.barcode).toUpperCase() !== barcode
    ) {
      throw new Error("SOURCING_LAUNCH_IDEMPOTENCY_CONFLICT");
    }
    return {
      ok: true as const,
      itemId: intakeId,
      modelNumber,
      barcode,
      replayed: true,
    };
  }

  const conflictingBarcode = items.find(
    (item) => text(item.barcode).toUpperCase() === barcode,
  );
  if (conflictingBarcode) throw new Error("SOURCING_LAUNCH_BCODE_ALREADY_EXISTS");
  const conflictingModel = items.find(
    (item) => text(item.modelNumber).toUpperCase() === modelNumber,
  );
  if (conflictingModel) throw new Error("SOURCING_LAUNCH_MODEL_ALREADY_EXISTS");

  const trackerRowNumber =
    items.reduce(
      (max, item) => Math.max(max, Math.floor(Number(item.trackerRowNumber) || 0)),
      0,
    ) + 1;
  const now = new Date().toISOString();
  const chinaLinks = supplierLink ? [supplierLink] : [];
  const newItem: RecordLike = {
    id: intakeId,
    notes: "신규소싱 입고확정 후 Commerce OS 자동등록",
    source: {
      system: "commerce-os-sourcing-engine",
      sourcingIntakeId: intakeId,
      receiptId,
      sourceLineId,
      materializedAt: now,
    },
    stages: {
      detailPage: stage(),
      priceKeyword: stage(),
      shoplingUpload: stage(),
      marketRegistration: stage(),
      orderMapping: stage(),
      inventoryReflection: stage(),
    },
    barcode,
    options: [saleOption],
    createdAt: now,
    updatedAt: now,
    updatedBy: "신규소싱 입고 자동등록",
    workBatch: "신규소싱입고",
    archivedAt: null,
    modelNumber,
    productName,
    optionLabels: [saleOption],
    orderOptions: [
      {
        id: "sourcing-option-" + intakeId,
        barcode,
        optionName: "옵션",
        saleOption,
        chinaOption,
        unitCostKrw,
        baseSalePriceKrw: 0,
        sourceOrderItemId: sourceLineId || null,
        optionBarcodeIdentityKey: "B:" + barcode,
        optionBarcodeIdentityKind: "B_CODE",
      },
    ],
    trackerRowNumber,
    warehouseLocation: barcode,
    chinaProductLinks: chinaLinks,
    primaryChinaProductLink: supplierLink,
    detailPageSource: {
      urls: chinaLinks,
      primaryUrl: supplierLink,
      pinnedIndex: supplierLink ? 0 : null,
      source: "sourcing_inbound_auto",
      updatedAt: now,
    },
  };

  const nextState = {
    ...current,
    schemaVersion: Math.max(3, Math.floor(Number(current.schemaVersion) || 3)),
    items: [...items, newItem],
  } as ProductLaunchTrackerState;
  const written = (await writeProductLaunchState(
    config.value,
    identity,
    nextState as unknown as RecordLike,
  )) as RecordLike;
  const persisted = record(written.state_payload) as ProductLaunchTrackerState;
  const sourceUpdatedAt = text(written.updated_at) || now;
  const normalized = await syncProductLaunchNormalizedChangedItems(
    config.value,
    identity,
    persisted,
    sourceUpdatedAt,
    [intakeId],
  );
  if (normalized.synced === false) {
    await syncProductLaunchNormalizedFull(
      config.value,
      identity,
      persisted,
      sourceUpdatedAt,
    );
  }

  return {
    ok: true as const,
    itemId: intakeId,
    modelNumber,
    barcode,
    trackerRowNumber,
    replayed: false,
  };
}
