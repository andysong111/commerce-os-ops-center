import type {
  InventoryStockoutResetEvent,
  ShoplingStockProductKind,
} from "@/lib/inventoryStockControl";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";

const DEFAULT_PRODUCT_MASTER_URL =
  "https://commerce-os-product-master.vercel.app";
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

type PlanningProduct = {
  barcode?: unknown;
  modelNo?: unknown;
  optionName?: unknown;
  skuActive?: unknown;
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
    if (
      row.confirmed !== true ||
      row.verified !== true ||
      row.requiresReview === true ||
      text(row.baselineKind).toUpperCase() !== "SOLD_OUT_RESET" ||
      row.baselineQuantity !== 0
    ) {
      continue;
    }
    const code = barcode(row.barcode);
    const occurredAt = iso(row.baselineAt);
    const profile = planningByBarcode.get(code);
    if (!code || !profile || !occurredAt) continue;
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

function connection() {
  const secret = process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim();
  const base = (
    process.env.PRODUCT_MASTER_BASE_URL?.trim() || DEFAULT_PRODUCT_MASTER_URL
  ).replace(/\/$/, "");
  if (!secret || !/^https:\/\//.test(base)) {
    throw new Error("PRODUCT_MASTER_INVENTORY_BASELINE_CONNECTION_REQUIRED");
  }
  return { base, secret };
}

export async function loadProductMasterVerifiedInventoryBaselines(
  planningProducts: PlanningProduct[],
) {
  const { base, secret } = connection();
  const response = await fetch(`${base}/api/integrations/inventory-snapshot`, {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-commerce-os-integration-secret": secret,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`PRODUCT_MASTER_INVENTORY_BASELINE_HTTP_${response.status}`);
  }
  return parseProductMasterVerifiedInventoryBaselines(
    await response.json(),
    planningProducts,
  );
}

// Product Master VERIFIED zero resets are already user-backed physical facts.
// Convert only those zero facts into optional read-only reset events. They are
// fed into the normal inventory engine, which recomputes receipts + canonical
// sales after the reset. Any Product Master read failure simply contributes no
// supplemental evidence and can never manufacture stock readiness.
export async function loadProductMasterVerifiedZeroResetEvents(): Promise<
  InventoryStockoutResetEvent[]
> {
  try {
    const planning = await loadProductPlanningSnapshot();
    const baselines = await loadProductMasterVerifiedInventoryBaselines(
      planning.products ?? [],
    );
    return [...baselines.values()].map((baseline) => ({
      eventId: baseline.eventId,
      barcode: baseline.barcode,
      productKind: baseline.productKind,
      modelNo: baseline.modelNo,
      occurredAt: baseline.occurredAt,
      note: baseline.note,
    }));
  } catch {
    return [];
  }
}
