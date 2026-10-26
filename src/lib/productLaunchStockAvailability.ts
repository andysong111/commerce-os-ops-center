import { legacySeoRegistrationExclusion } from "./legacySeoRegistrationPolicy.ts";
import {
  loadProductMasterInventoryCostReadiness,
  type ProductMasterInventoryCostReadiness,
  type ProductMasterInventoryCostRow,
} from "./productMasterInventoryCostReadiness.ts";

type UnknownRecord = Record<string, unknown>;

export type ProductLaunchOptionStockStatus = "ON_SALE" | "SOLD_OUT" | "UNKNOWN";
export type ProductLaunchStockStatus =
  | "ON_SALE"
  | "PARTIAL_SOLD_OUT"
  | "SOLD_OUT"
  | "UNKNOWN"
  | "EXCLUDED";

export type ProductLaunchOptionStockAvailability = {
  id: string;
  label: string;
  barcode: string;
  status: ProductLaunchOptionStockStatus;
  quantity: number | null;
  reason: string;
};

export type ProductLaunchStockAvailability = {
  status: ProductLaunchStockStatus;
  label: string;
  reason: string;
  selectable: boolean;
  enforced: true;
  checkedAt: string;
  sourceFingerprint: string;
  options: ProductLaunchOptionStockAvailability[];
};

export type ProductLaunchInventoryIndex = {
  checkedAt: string;
  sourceFingerprint: string;
  byBarcode: Map<string, ProductMasterInventoryCostRow>;
};

let cachedSnapshot:
  | { expiresAt: number; value: ProductMasterInventoryCostReadiness }
  | null = null;
let pendingSnapshot: Promise<ProductMasterInventoryCostReadiness> | null = null;

export async function loadProductLaunchInventorySnapshot(
  options: { maxAgeMs?: number; requestTimeoutMs?: number } = {},
) {
  const maxAgeMs = Math.max(0, Math.min(30_000, options.maxAgeMs ?? 10_000));
  if (cachedSnapshot && cachedSnapshot.expiresAt > Date.now()) {
    return cachedSnapshot.value;
  }
  if (!pendingSnapshot) {
    pendingSnapshot = loadProductMasterInventoryCostReadiness({
      requestTimeoutMs: options.requestTimeoutMs ?? 15_000,
    }).finally(() => {
      pendingSnapshot = null;
    });
  }
  const value = await pendingSnapshot;
  cachedSnapshot = { value, expiresAt: Date.now() + maxAgeMs };
  return value;
}

export function buildProductLaunchInventoryIndex(
  snapshot: ProductMasterInventoryCostReadiness,
): ProductLaunchInventoryIndex {
  const byBarcode = new Map<string, ProductMasterInventoryCostRow>();
  for (const row of snapshot.rows) {
    const barcode = normalizeCode(row.barcode);
    if (barcode) byBarcode.set(barcode, row);
  }
  return {
    checkedAt: text(snapshot.generatedAt) || new Date().toISOString(),
    sourceFingerprint: text(snapshot.contentFingerprint),
    byBarcode,
  };
}

export function classifyProductLaunchStockAvailability(
  itemInput: unknown,
  inventory: ProductLaunchInventoryIndex,
): ProductLaunchStockAvailability {
  const item = record(itemInput);
  const exclusion = legacySeoRegistrationExclusion(item);
  const summarizedExclusion = record(item.seoExclusion);
  const archived = Boolean(text(item.archivedAt));
  const optionSources = readOptionSources(item);
  const options = optionSources.map((option, index) =>
    classifyOptionStock(option, index, inventory),
  );

  if (exclusion.excluded || summarizedExclusion.excluded === true || archived) {
    const reason = archived
      ? "보관 상품"
      : exclusion.reason || text(summarizedExclusion.reason) || "단종·등록 제외 상품";
    return availability("EXCLUDED", reason, options, inventory);
  }
  if (!options.length) {
    return availability("UNKNOWN", "재고를 연결할 옵션 또는 B코드가 없습니다.", [], inventory);
  }
  if (options.some((option) => option.status === "UNKNOWN")) {
    const first = options.find((option) => option.status === "UNKNOWN");
    return availability(
      "UNKNOWN",
      first?.reason || "확인되지 않은 옵션 재고가 있습니다.",
      options,
      inventory,
    );
  }
  const soldOutCount = options.filter((option) => option.status === "SOLD_OUT").length;
  if (soldOutCount === options.length) {
    return availability("SOLD_OUT", "모든 옵션의 확인 재고가 0개입니다.", options, inventory);
  }
  if (soldOutCount > 0) {
    return availability(
      "PARTIAL_SOLD_OUT",
      `${soldOutCount}개 옵션은 품절 상태로 등록됩니다.`,
      options,
      inventory,
    );
  }
  return availability("ON_SALE", "모든 옵션에 확인 재고가 있습니다.", options, inventory);
}

export function applyProductLaunchStockAvailability(
  itemInput: unknown,
  stock: ProductLaunchStockAvailability,
) {
  const item = record(itemInput);
  const stockByBarcode = new Map(
    stock.options.map((option) => [normalizeCode(option.barcode), option]),
  );
  const orderOptions = Array.isArray(item.orderOptions)
    ? item.orderOptions.map((value) => {
        const option = record(value);
        const matched = stockByBarcode.get(normalizeCode(option.barcode));
        return {
          ...option,
          stockStatus: matched?.status ?? "UNKNOWN",
          verifiedInventoryQuantity: matched?.quantity ?? null,
        };
      })
    : [];
  return {
    ...item,
    orderOptions,
    stockAvailability: stock,
  };
}

export function productLaunchStockBlockReason(stock: ProductLaunchStockAvailability) {
  if (stock.selectable) return "";
  if (stock.status === "SOLD_OUT") return "전체 품절 상품은 등록할 수 없습니다.";
  if (stock.status === "EXCLUDED") return stock.reason || "단종·보관 상품은 등록할 수 없습니다.";
  return stock.reason || "재고 확인이 끝나지 않아 등록할 수 없습니다.";
}

export function productLaunchStockMatchesFilter(
  stock: ProductLaunchStockAvailability,
  filterInput: unknown,
) {
  const filter = text(filterInput).toUpperCase() || "SELLABLE";
  if (filter === "ALL") return true;
  if (filter === "SELLABLE") return stock.selectable;
  if (filter === "PARTIAL_SOLD_OUT") return stock.status === "PARTIAL_SOLD_OUT";
  if (filter === "SOLD_OUT") return stock.status === "SOLD_OUT" || stock.status === "EXCLUDED";
  if (filter === "UNKNOWN") return stock.status === "UNKNOWN";
  return stock.selectable;
}

function readOptionSources(item: UnknownRecord) {
  const orderOptions = Array.isArray(item.orderOptions)
    ? item.orderOptions.filter(isRecord)
    : [];
  if (orderOptions.length) return orderOptions;
  const optionLocations = Array.isArray(item.optionLocations)
    ? item.optionLocations.filter(isRecord)
    : [];
  if (optionLocations.length) return optionLocations;
  const barcode = normalizeCode(item.barcode);
  return barcode
    ? [{ id: "single", saleOption: text(item.productName) || "단품", barcode }]
    : [];
}

function classifyOptionStock(
  option: UnknownRecord,
  index: number,
  inventory: ProductLaunchInventoryIndex,
): ProductLaunchOptionStockAvailability {
  const barcode = normalizeCode(option.barcode);
  const label = text(option.saleOption ?? option.label) || `${index + 1}번째 옵션`;
  const id = text(option.id) || `option-${index + 1}`;
  if (!barcode) {
    return { id, label, barcode: "", status: "UNKNOWN", quantity: null, reason: `${label} B코드가 없습니다.` };
  }
  const row = inventory.byBarcode.get(barcode);
  if (!row) {
    return { id, label, barcode, status: "UNKNOWN", quantity: null, reason: `${label}(${barcode}) 재고 자료를 찾지 못했습니다.` };
  }
  const quantity = Number(row.inventoryQuantity);
  if (
    row.inventoryVerified !== true ||
    row.inventoryRequiresReview === true ||
    !Number.isFinite(quantity)
  ) {
    return { id, label, barcode, status: "UNKNOWN", quantity: Number.isFinite(quantity) ? quantity : null, reason: `${label}(${barcode}) 재고 확인이 필요합니다.` };
  }
  return quantity <= 0
    ? { id, label, barcode, status: "SOLD_OUT", quantity, reason: `${label}(${barcode}) 확인 재고 0개` }
    : { id, label, barcode, status: "ON_SALE", quantity, reason: `${label}(${barcode}) 확인 재고 ${quantity}개` };
}

function availability(
  status: ProductLaunchStockStatus,
  reason: string,
  options: ProductLaunchOptionStockAvailability[],
  inventory: ProductLaunchInventoryIndex,
): ProductLaunchStockAvailability {
  const labels: Record<ProductLaunchStockStatus, string> = {
    ON_SALE: "판매 가능",
    PARTIAL_SOLD_OUT: "일부 옵션 품절",
    SOLD_OUT: "전체 품절",
    UNKNOWN: "재고 확인 필요",
    EXCLUDED: "단종·보관",
  };
  return {
    status,
    label: labels[status],
    reason,
    selectable: status === "ON_SALE" || status === "PARTIAL_SOLD_OUT",
    enforced: true,
    checkedAt: inventory.checkedAt,
    sourceFingerprint: inventory.sourceFingerprint,
    options,
  };
}

function normalizeCode(value: unknown) {
  return text(value).normalize("NFKC").toUpperCase().replace(/\s+/g, "");
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function record(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
