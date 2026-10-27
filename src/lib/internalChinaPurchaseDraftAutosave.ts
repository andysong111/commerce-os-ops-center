import type { InventoryStockBand } from "@/lib/inventoryStockBulkInput";

const AUTOSAVE_VERSION = 1;
const AUTOSAVE_PREFIX = "commerce-os:china-purchase-draft:pending:v1:";
const AUTOSAVE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1_000;
const STOCK_BANDS = new Set<InventoryStockBand>(["HIGH", "NORMAL", "LOW", "OUT"]);

export type PurchaseDraftPendingAddition = {
  barcode: string;
  modelNo: string;
  productName: string;
  optionName: string;
  inDraft: boolean;
  currentDraftQuantity: number;
  otherOpenQuantity: number;
  targetQuantity: number;
};

export type PurchaseDraftPendingAutosave = {
  editedQuantities: Record<string, number>;
  stagedExclusions: Record<string, boolean>;
  releasedQuantityOverrides: Record<string, boolean>;
  stagedStockBands: Record<string, InventoryStockBand>;
  stagedAdditions: PurchaseDraftPendingAddition[];
};

type StoredAutosave = PurchaseDraftPendingAutosave & {
  version: typeof AUTOSAVE_VERSION;
  draftId: string;
  savedAt: string;
};

type AutosaveStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function barcode(value: unknown) {
  const normalized = String(value ?? "").normalize("NFKC").trim().toUpperCase();
  return /^[A-Z]{3}\d+-\d+$/.test(normalized) ? normalized : "";
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function quantityMap(value: unknown) {
  const source = object(value);
  if (!source) return {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, candidate]) => [barcode(key), integer(candidate)] as const)
      .filter(([key, candidate]) => key && candidate > 0),
  );
}

function trueMap(value: unknown) {
  const source = object(value);
  if (!source) return {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, candidate]) => [barcode(key), candidate === true] as const)
      .filter(([key, candidate]) => key && candidate),
  );
}

function stockBandMap(value: unknown) {
  const source = object(value);
  if (!source) return {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, candidate]) => [barcode(key), String(candidate ?? "")] as const)
      .filter(([key, candidate]) =>
        Boolean(key) && STOCK_BANDS.has(candidate as InventoryStockBand),
      ),
  ) as Record<string, InventoryStockBand>;
}

function additions(value: unknown): PurchaseDraftPendingAddition[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const row = object(candidate);
    const normalizedBarcode = barcode(row?.barcode);
    const targetQuantity = integer(row?.targetQuantity);
    if (!row || !normalizedBarcode || targetQuantity <= 0) return [];
    return [{
      barcode: normalizedBarcode,
      modelNo: String(row.modelNo ?? ""),
      productName: String(row.productName ?? ""),
      optionName: String(row.optionName ?? ""),
      inDraft: row.inDraft === true,
      currentDraftQuantity: integer(row.currentDraftQuantity),
      otherOpenQuantity: integer(row.otherOpenQuantity),
      targetQuantity,
    }];
  });
}

export function purchaseDraftPendingAutosaveKey(draftId: string) {
  return `${AUTOSAVE_PREFIX}${draftId}`;
}

export function hasPurchaseDraftPendingChanges(value: PurchaseDraftPendingAutosave) {
  return Object.keys(value.editedQuantities).length > 0 ||
    Object.keys(value.stagedExclusions).length > 0 ||
    Object.keys(value.releasedQuantityOverrides).length > 0 ||
    Object.keys(value.stagedStockBands).length > 0 ||
    value.stagedAdditions.length > 0;
}

export function readPurchaseDraftPendingAutosave(
  storage: AutosaveStorage,
  draftId: string,
  now = Date.now(),
): PurchaseDraftPendingAutosave | null {
  try {
    const raw = storage.getItem(purchaseDraftPendingAutosaveKey(draftId));
    if (!raw) return null;
    const parsed = object(JSON.parse(raw));
    const savedAt = Date.parse(String(parsed?.savedAt ?? ""));
    if (
      !parsed ||
      parsed.version !== AUTOSAVE_VERSION ||
      parsed.draftId !== draftId ||
      !Number.isFinite(savedAt) ||
      now - savedAt > AUTOSAVE_MAX_AGE_MS
    ) {
      storage.removeItem(purchaseDraftPendingAutosaveKey(draftId));
      return null;
    }
    const restored: PurchaseDraftPendingAutosave = {
      editedQuantities: quantityMap(parsed.editedQuantities),
      stagedExclusions: trueMap(parsed.stagedExclusions),
      releasedQuantityOverrides: trueMap(parsed.releasedQuantityOverrides),
      stagedStockBands: stockBandMap(parsed.stagedStockBands),
      stagedAdditions: additions(parsed.stagedAdditions),
    };
    if (!hasPurchaseDraftPendingChanges(restored)) {
      storage.removeItem(purchaseDraftPendingAutosaveKey(draftId));
      return null;
    }
    return restored;
  } catch {
    storage.removeItem(purchaseDraftPendingAutosaveKey(draftId));
    return null;
  }
}

export function writePurchaseDraftPendingAutosave(
  storage: AutosaveStorage,
  draftId: string,
  value: PurchaseDraftPendingAutosave,
  savedAt = new Date(),
) {
  if (!hasPurchaseDraftPendingChanges(value)) {
    storage.removeItem(purchaseDraftPendingAutosaveKey(draftId));
    return;
  }
  const stored: StoredAutosave = {
    version: AUTOSAVE_VERSION,
    draftId,
    savedAt: savedAt.toISOString(),
    ...value,
  };
  storage.setItem(purchaseDraftPendingAutosaveKey(draftId), JSON.stringify(stored));
}

export function clearPurchaseDraftPendingAutosave(
  storage: AutosaveStorage,
  draftId: string,
) {
  storage.removeItem(purchaseDraftPendingAutosaveKey(draftId));
}
