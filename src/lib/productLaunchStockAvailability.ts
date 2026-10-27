import { legacySeoRegistrationExclusion } from "./legacySeoRegistrationPolicy.ts";
import {
  type ProductLaunchStockStatusIndex,
} from "./productLaunchShoplingStockState.ts";

export {
  buildProductLaunchStockStatusIndex,
  loadProductLaunchShoplingStockSnapshot,
} from "./productLaunchShoplingStockState.ts";

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

export function classifyProductLaunchStockAvailability(
  itemInput: unknown,
  stockIndex: ProductLaunchStockStatusIndex,
): ProductLaunchStockAvailability {
  const item = record(itemInput);
  const exclusion = legacySeoRegistrationExclusion(item);
  const summarizedExclusion = record(item.seoExclusion);
  const archived = Boolean(text(item.archivedAt));
  const optionSources = readOptionSources(item);
  const options = optionSources.map((option, index) =>
    classifyOptionStock(option, index, stockIndex),
  );

  if (exclusion.excluded || summarizedExclusion.excluded === true || archived) {
    const reason = archived
      ? "보관 상품"
      : exclusion.reason || text(summarizedExclusion.reason) || "단종·등록 제외 상품";
    return availability("EXCLUDED", reason, options, stockIndex);
  }
  if (!options.length) {
    return availability("UNKNOWN", "판매상태를 연결할 옵션 또는 B코드가 없습니다.", [], stockIndex);
  }
  if (options.some((option) => option.status === "UNKNOWN")) {
    const first = options.find((option) => option.status === "UNKNOWN");
    return availability(
      "UNKNOWN",
      first?.reason || "확인되지 않은 옵션 판매상태가 있습니다.",
      options,
      stockIndex,
    );
  }
  const soldOutCount = options.filter((option) => option.status === "SOLD_OUT").length;
  if (soldOutCount === options.length) {
    return availability(
      "SOLD_OUT",
      "모든 옵션이 커머스 OS에서 품절 전송된 상태입니다.",
      options,
      stockIndex,
    );
  }
  if (soldOutCount > 0) {
    return availability(
      "PARTIAL_SOLD_OUT",
      `${soldOutCount}개 옵션은 품절 상태로 등록됩니다.`,
      options,
      stockIndex,
    );
  }
  return availability(
    "ON_SALE",
    "모든 옵션이 커머스 OS 전송 기준 판매중입니다.",
    options,
    stockIndex,
  );
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
  return stock.reason || "판매상태 전송 확인이 끝나지 않아 등록할 수 없습니다.";
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
  stockIndex: ProductLaunchStockStatusIndex,
): ProductLaunchOptionStockAvailability {
  const barcode = normalizeCode(option.barcode);
  const label = text(option.saleOption ?? option.label) || `${index + 1}번째 옵션`;
  const id = text(option.id) || `option-${index + 1}`;
  if (!barcode) {
    return { id, label, barcode: "", status: "UNKNOWN", quantity: null, reason: `${label} B코드가 없습니다.` };
  }
  const state = stockIndex.byBarcode.get(barcode);
  if (!state) {
    return {
      id,
      label,
      barcode,
      status: "ON_SALE",
      quantity: null,
      reason: `${label}(${barcode}) 커머스 OS 품절 전송 이력이 없어 판매중`,
    };
  }
  if (
    state.latestEvent.outcome === "STARTED" ||
    state.latestEvent.outcome === "UNCERTAIN"
  ) {
    return {
      id,
      label,
      barcode,
      status: "UNKNOWN",
      quantity: null,
      reason: `${label}(${barcode}) 최신 ${statusLabel(state.latestEvent.desiredStatus)} 전송 결과 확인 필요`,
    };
  }
  const succeeded = state.latestSucceeded;
  if (!succeeded) {
    return {
      id,
      label,
      barcode,
      status: "ON_SALE",
      quantity: null,
      reason: `${label}(${barcode}) 완료된 품절 전송 이력이 없어 판매중`,
    };
  }
  const status = succeeded.desiredStatus === "SOLD_OUT" ? "SOLD_OUT" : "ON_SALE";
  return {
    id,
    label,
    barcode,
    status,
    quantity: null,
    reason: `${label}(${barcode}) 커머스 OS ${statusLabel(succeeded.desiredStatus)} 전송 완료`,
  };
}

function availability(
  status: ProductLaunchStockStatus,
  reason: string,
  options: ProductLaunchOptionStockAvailability[],
  stockIndex: ProductLaunchStockStatusIndex,
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
    checkedAt: stockIndex.checkedAt,
    sourceFingerprint: stockIndex.sourceFingerprint,
    options,
  };
}

function statusLabel(status: "SOLD_OUT" | "ON_SALE") {
  return status === "SOLD_OUT" ? "품절" : "판매중";
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
