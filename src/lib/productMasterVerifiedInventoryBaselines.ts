import type {
  InventoryStockoutResetEvent,
  ShoplingStockProductKind,
} from "@/lib/inventoryStockControl";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import type { PlanningProduct } from "@/lib/shopling/shoplingLiveAggregation";

const BARCODE_PATTERN = /^B[A-Z]{1,2}\d+-\d+$/;

export type ProductMasterVerifiedInventoryBaseline = {
  eventId: string;
  barcode: string;
  productKind: ShoplingStockProductKind;
  modelNo: string | null;
  baselineQuantity: 0;
  occurredAt: string;
  note: string;
};

type ParseOptions = {
  requireCompleteVerifiedResets?: boolean;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function barcode(value: unknown) {
  const normalized = text(value)
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "");
  return BARCODE_PATTERN.test(normalized) ? normalized : "";
}

function iso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function productKind(optionName: unknown): ShoplingStockProductKind {
  const option = text(optionName);
  return !option || option === "단품" ? "SINGLE" : "OPTION";
}

export function parseProductMasterVerifiedInventoryBaselines(
  payload: unknown,
  planningProducts: PlanningProduct[],
  options: ParseOptions = {},
) {
  const root = object(payload);
  if (root.ok !== true || !Array.isArray(root.inventories)) {
    throw new Error("PRODUCT_MASTER_INVENTORY_BASELINE_PAYLOAD_INVALID");
  }
  const planningByBarcode = new Map(
    planningProducts
      .filter((row) => row?.skuActive !== false)
      .map((row) => [barcode(row?.barcode), row] as const)
      .filter(([code]) => Boolean(code)),
  );
  const latest = new Map<string, ProductMasterVerifiedInventoryBaseline>();
  for (const raw of root.inventories) {
    const row = object(raw);
    const authoritativeReset =
      row.confirmed === true &&
      row.verified === true &&
      row.requiresReview !== true &&
      text(row.baselineKind).toUpperCase() === "SOLD_OUT_RESET";
    if (!authoritativeReset) continue;

    const code = barcode(row.barcode);
    const occurredAt = iso(row.baselineAt);
    const profile = planningByBarcode.get(code);
    if (options.requireCompleteVerifiedResets === true) {
      // A successful HTTP/root payload is not enough. If Product Master claims
      // an authoritative zero reset, every field needed to preserve that
      // physical fact must be complete. Otherwise purchase-cycle closure cannot
      // safely reinterpret the row as "no baseline yet".
      if (row.baselineQuantity !== 0 || !code || !occurredAt || !profile) {
        throw new Error("PRODUCT_MASTER_VERIFIED_ZERO_RESET_INCOMPLETE");
      }
    }
    if (row.baselineQuantity !== 0 || !code || !profile || !occurredAt) continue;

    const event: ProductMasterVerifiedInventoryBaseline = {
      eventId: `product-master-sold-out-reset:${code}:${occurredAt}`,
      barcode: code,
      productKind: productKind(profile.optionName),
      modelNo: text(profile.modelNo) || null,
      baselineQuantity: 0,
      occurredAt,
      note: "Product Master VERIFIED SOLD_OUT_RESET 기준점",
    };
    const current = latest.get(code);
    if (!current || event.occurredAt > current.occurredAt) {
      latest.set(code, event);
    }
  }
  return latest;
}

function inventoryPayloadFromPlanning(planningProducts: PlanningProduct[]) {
  return {
    ok: true,
    inventories: planningProducts.map((row) => ({
      barcode: row.barcode,
      confirmed: row.inventoryConfirmed,
      verified: row.inventoryVerified,
      requiresReview: row.inventoryRequiresReview,
      baselineKind: row.inventoryBaselineKind,
      baselineQuantity: row.inventoryBaselineQuantity,
      baselineAt: row.inventoryBaselineAt,
    })),
  };
}

export function loadProductMasterVerifiedInventoryBaselines(
  planningProducts: PlanningProduct[],
  options: ParseOptions = {},
) {
  return parseProductMasterVerifiedInventoryBaselines(
    inventoryPayloadFromPlanning(planningProducts),
    planningProducts,
    options,
  );
}

function resetEventsFromBaselines(
  baselines: Map<string, ProductMasterVerifiedInventoryBaseline>,
): InventoryStockoutResetEvent[] {
  return [...baselines.values()].map((baseline) => ({
    eventId: baseline.eventId,
    barcode: baseline.barcode,
    productKind: baseline.productKind,
    modelNo: baseline.modelNo,
    occurredAt: baseline.occurredAt,
    note: baseline.note,
  }));
}

// Purchase-cycle closure uses this strict reader. An unavailable or incomplete
// Product Master cannot be interpreted as "this SKU never had a baseline",
// because doing so could erase an existing zero reset and bypass its sales/sync obligations.
export async function loadRequiredProductMasterVerifiedZeroResetEvents(
  planningProducts?: PlanningProduct[],
): Promise<
  InventoryStockoutResetEvent[]
> {
  const products =
    planningProducts ?? (await loadProductPlanningSnapshot()).products ?? [];
  const baselines = loadProductMasterVerifiedInventoryBaselines(
    products,
    { requireCompleteVerifiedResets: true },
  );
  return resetEventsFromBaselines(baselines);
}

// The operational stock-control queue remains fail-soft: if Product Master is
// temporarily unavailable or incomplete it simply receives no supplemental reset
// and therefore cannot create a new actionable exact-stock row from missing data.
// Purchase-cycle readiness must use the strict loader above instead.
export async function loadProductMasterVerifiedZeroResetEvents(
  planningProducts?: PlanningProduct[],
): Promise<
  InventoryStockoutResetEvent[]
> {
  try {
    return await loadRequiredProductMasterVerifiedZeroResetEvents(
      planningProducts,
    );
  } catch {
    return [];
  }
}
