import { createHash } from "node:crypto";
import type {
  ExactInventoryAfterReset,
  InventoryStockControlReport,
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
  productName?: unknown;
  skuActive?: unknown;
  listings?: Array<{ goodsKey?: unknown; active?: unknown }>;
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
      Number(row.baselineQuantity) !== 0
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

function fingerprint(rows: ExactInventoryAfterReset[]) {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify(
        rows.map((row) => [
          row.barcode,
          row.resetEventId,
          row.resetAt,
          row.exactInventoryQuantity,
          row.salesCoverageReady,
        ]),
      ),
    )
    .digest("hex")}`;
}

// Product Master VERIFIED zero resets are already user-backed physical facts.
// Reuse them as read-only baselines so the operator is not asked to reconfirm
// the same zero stock. Positive stocktakes are intentionally excluded here:
// the local OPS stocktake path remains authoritative for non-zero quantities.
export async function overlayProductMasterVerifiedZeroBaselines(
  report: InventoryStockControlReport,
): Promise<InventoryStockControlReport> {
  let planning: Awaited<ReturnType<typeof loadProductPlanningSnapshot>>;
  try {
    planning = await loadProductPlanningSnapshot();
  } catch {
    return report;
  }
  let baselines: Map<string, ProductMasterVerifiedInventoryBaseline>;
  try {
    baselines = await loadProductMasterVerifiedInventoryBaselines(
      planning.products ?? [],
    );
  } catch {
    return report;
  }
  if (!baselines.size) return report;

  const planningByBarcode = new Map(
    (planning.products ?? [])
      .filter((row) => row.skuActive !== false)
      .map((row) => [barcode(row.barcode), row] as const)
      .filter(([code]) => Boolean(code)),
  );
  const rowsByBarcode = new Map(report.rows.map((row) => [row.barcode, row]));

  for (const baseline of baselines.values()) {
    const current = rowsByBarcode.get(baseline.barcode) ?? null;
    if (
      current &&
      Date.parse(current.resetAt) >= Date.parse(baseline.occurredAt)
    ) {
      continue;
    }
    const profile = planningByBarcode.get(baseline.barcode);
    if (!profile) continue;
    const goodsKeys = [
      ...new Set(
        (profile.listings ?? [])
          .filter((listing) => listing.active !== false)
          .map((listing) => text(listing.goodsKey))
          .filter((value) => /^\d+$/.test(value)),
      ),
    ].sort((left, right) => Number(left) - Number(right));

    rowsByBarcode.set(baseline.barcode, {
      barcode: baseline.barcode,
      productName: text(profile.productName) || baseline.barcode,
      optionName: text(profile.optionName) || null,
      modelNo: baseline.modelNo,
      goodsKeys,
      productKind: baseline.productKind,
      resetAt: baseline.occurredAt,
      resetEventId: baseline.eventId,
      receivedSinceReset: 0,
      soldSinceReset: 0,
      exactInventoryQuantity: 0,
      recent30StockoutDays: 0,
      desiredStatus: "SOLD_OUT",
      desiredSince: baseline.occurredAt,
      salesCoverageReady: false,
      receiptEvidenceCount: 0,
      salesEvidenceCount: 0,
      latestSyncOutcome: null,
      latestSyncAt: null,
      syncNeeded: true,
      syncBlocked: true,
      syncBlockReason:
        "Product Master의 확인된 재고 0 기준점 이후 판매범위를 최신화해야 합니다.",
    });
  }

  const rows = [...rowsByBarcode.values()].sort((left, right) =>
    left.barcode.localeCompare(right.barcode, "ko"),
  );
  return {
    ...report,
    rows,
    resetCount: rows.length,
    exactCount: rows.filter((row) => row.salesCoverageReady).length,
    soldOutCount: rows.filter(
      (row) => row.salesCoverageReady && row.desiredStatus === "SOLD_OUT",
    ).length,
    onSaleCount: rows.filter(
      (row) => row.salesCoverageReady && row.desiredStatus === "ON_SALE",
    ).length,
    pendingSyncCount: rows.filter(
      (row) => row.salesCoverageReady && row.syncNeeded && !row.syncBlocked,
    ).length,
    fingerprint: fingerprint(rows),
  };
}
