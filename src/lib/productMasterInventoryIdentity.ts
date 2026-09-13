import type { ShoplingStockProductKind } from "@/lib/inventoryStockControl";

const DEFAULT_PRODUCT_MASTER_URL =
  "https://commerce-os-product-master.vercel.app";
const BARCODE_PATTERN = /^B[A-Z]{1,2}\d+-\d+$/;

export type ProductMasterInventoryIdentity = {
  barcode: string;
  state: "READY" | "MISSING" | "CONFLICT";
  reason: string | null;
  skuId: string | null;
  productId: string | null;
  modelNo: string | null;
  productName: string | null;
  optionName: string | null;
  productKind: ShoplingStockProductKind | null;
  activeSkuCount: number;
};

type IdentityPayload = {
  ok?: boolean;
  items?: unknown;
  message?: string;
  error?: string;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

export function normalizeInventoryBarcode(value: unknown) {
  const normalized = text(value)
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "");
  return BARCODE_PATTERN.test(normalized) ? normalized : "";
}

export function normalizeInventoryBarcodes(values: unknown[], max = 100) {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const barcode = normalizeInventoryBarcode(value);
    if (!barcode || seen.has(barcode)) continue;
    seen.add(barcode);
    output.push(barcode);
    if (output.length >= Math.max(1, Math.min(500, max))) break;
  }
  return output;
}

function connection() {
  const secret = process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim();
  if (!secret) throw new Error("PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED");
  const baseUrl = (
    process.env.PRODUCT_MASTER_BASE_URL?.trim() || DEFAULT_PRODUCT_MASTER_URL
  ).replace(/\/$/, "");
  if (!/^https:\/\//.test(baseUrl)) {
    throw new Error("PRODUCT_MASTER_BASE_URL_INVALID");
  }
  return { baseUrl, secret };
}

function normalizeIdentity(value: unknown): ProductMasterInventoryIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const barcode = normalizeInventoryBarcode(row.barcode);
  const state = text(row.state).toUpperCase();
  const productKind = text(row.productKind).toUpperCase();
  if (!barcode || !["READY", "MISSING", "CONFLICT"].includes(state)) return null;
  const kind: ShoplingStockProductKind | null =
    productKind === "SINGLE" || productKind === "OPTION"
      ? productKind
      : null;
  return {
    barcode,
    state: state as ProductMasterInventoryIdentity["state"],
    reason: text(row.reason) || null,
    skuId: text(row.skuId) || null,
    productId: text(row.productId) || null,
    modelNo: text(row.modelNo).toUpperCase() || null,
    productName: text(row.productName) || null,
    optionName: text(row.optionName) || null,
    productKind: kind,
    activeSkuCount: Math.max(0, Math.round(Number(row.activeSkuCount) || 0)),
  };
}

export async function loadProductMasterInventoryIdentities(
  inputBarcodes: unknown[],
): Promise<ProductMasterInventoryIdentity[]> {
  const barcodes = normalizeInventoryBarcodes(inputBarcodes, 100);
  if (!barcodes.length) return [];
  const { baseUrl, secret } = connection();
  const response = await fetch(`${baseUrl}/api/integrations/inventory-identities`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-commerce-os-integration-secret": secret,
    },
    body: JSON.stringify({ barcodes }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => ({}))) as IdentityPayload;
  if (!response.ok || payload.ok !== true || !Array.isArray(payload.items)) {
    throw new Error(
      payload.message ||
        payload.error ||
        `PRODUCT_MASTER_INVENTORY_IDENTITIES_FAILED:${response.status}`,
    );
  }
  const normalized = payload.items
    .map(normalizeIdentity)
    .filter((item): item is ProductMasterInventoryIdentity => Boolean(item));
  const byBarcode = new Map(normalized.map((item) => [item.barcode, item] as const));
  return barcodes.map((barcode) => {
    const item = byBarcode.get(barcode);
    if (!item) {
      return {
        barcode,
        state: "CONFLICT" as const,
        reason: "IDENTITY_RESPONSE_MISSING",
        skuId: null,
        productId: null,
        modelNo: null,
        productName: null,
        optionName: null,
        productKind: null,
        activeSkuCount: 0,
      };
    }
    if (item.state === "READY" && !item.productKind) {
      return { ...item, state: "CONFLICT" as const, reason: "PRODUCT_KIND_MISSING" };
    }
    return item;
  });
}

export async function requireProductMasterInventoryIdentity(barcode: unknown) {
  const normalized = normalizeInventoryBarcode(barcode);
  if (!normalized) throw new Error("INVENTORY_BARCODE_INVALID");
  const [identity] = await loadProductMasterInventoryIdentities([normalized]);
  if (!identity || identity.state !== "READY" || !identity.productKind) {
    throw new Error(
      `INVENTORY_BARCODE_IDENTITY_BLOCKED:${normalized}:${identity?.reason || identity?.state || "UNKNOWN"}`,
    );
  }
  return identity;
}
