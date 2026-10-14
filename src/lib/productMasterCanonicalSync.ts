import { dependentSkuContext } from "./productMasterCanonicalBatchContext.ts";
import {
  buildProductMasterSnapshotFromTrackerState,
  type ProductMasterSnapshotPayload,
} from "./productMasterSync.ts";
import { isSourcingReceiptPending } from "./sourcingReceiptGate.ts";

type R = Record<string, unknown>;
type StableSku = ProductMasterSnapshotPayload["skus"][number] & {
  sourceSystem: string;
  sourceSkuKey: string;
};

type CanonicalPayload = Omit<ProductMasterSnapshotPayload, "skus"> & {
  skus: StableSku[];
};

type ProductMasterCatalogProduct = {
  productId?: unknown;
  modelNo?: unknown;
};

export type ProductMasterBarcodeConflict = {
  barcode: string;
  itemIds: string[];
  sourceSkuKeys: string[];
};

const PRODUCT_MASTER_URL = "https://commerce-os-product-master.vercel.app";
const SOURCE_SYSTEM = "ops_product_launch_tracker";
const BATCH_SIZE = 500;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function object(value: unknown): R {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as R)
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalized(value: unknown) {
  return text(value).normalize("NFKC").replace(/\s+/g, "").toUpperCase();
}

function stableSkuId(sourceSkuKey: string) {
  return `sku-source:${encodeURIComponent(`${SOURCE_SYSTEM}:${sourceSkuKey}`)}`;
}

function fallbackOptionIdentity(value: unknown, index: number) {
  const normalizedName = normalized(value);
  return normalizedName ? `legacy-name:${normalizedName}` : `legacy-index:${index + 1}`;
}

function trackerOptions(item: R): R[] {
  const current = list(item.orderOptions).map(object);
  if (current.length) return current;
  const legacy = list(item.options).map((value, index) => ({
    id: fallbackOptionIdentity(value, index),
    saleOption: text(value),
  }));
  if (legacy.length) return legacy;
  return [
    {
      id: "default",
      saleOption: "단품",
      barcode: item.barcode || item.warehouseLocation,
    },
  ];
}

function sharedBarcodeIdentityMap(state: R) {
  const policy = object(state.skuIdentityPolicy);
  const sharedBarcodes = object(policy.sharedBarcodes);
  const result = new Map<string, string>();

  for (const [rawBarcode, rawConfig] of Object.entries(sharedBarcodes)) {
    const barcode = normalized(rawBarcode);
    if (!barcode) continue;
    const config = object(rawConfig);
    const identity =
      text(config.identity) || text(rawConfig) || `approved-shared-barcode:${barcode}`;
    result.set(barcode, identity);
  }

  return result;
}

function itemIdentity(item: R) {
  return text(item.id) || `model:${normalized(item.modelNumber)}`;
}

export function findCanonicalProductMasterBarcodeConflicts(
  input: unknown,
): ProductMasterBarcodeConflict[] {
  const state = object(input);
  const sharedBarcodeIdentities = sharedBarcodeIdentityMap(state);
  const assignments = new Map<
    string,
    Map<string, Set<string>>
  >();

  for (const rawItem of list(state.items)) {
    const item = object(rawItem);
    if (isSourcingReceiptPending(item)) continue;
    const itemId = itemIdentity(item);
    const options = trackerOptions(item);
    const rowBarcode = normalized(item.barcode || item.warehouseLocation);
    for (const [index, rawOption] of options.entries()) {
      const option = object(rawOption);
      const barcode =
        normalized(option.barcode) || (options.length === 1 ? rowBarcode : "");
      if (!barcode) continue;
      const optionId =
        text(option.id) ||
        fallbackOptionIdentity(option.saleOption || option.optionName, index);
      const approvedSharedIdentity = sharedBarcodeIdentities.get(barcode);
      const sourceSkuKey = approvedSharedIdentity
        ? `shared-physical:${approvedSharedIdentity}`
        : `${itemId}:${optionId}`;
      const bySource = assignments.get(barcode) ?? new Map<string, Set<string>>();
      const itemIds = bySource.get(sourceSkuKey) ?? new Set<string>();
      itemIds.add(itemId);
      bySource.set(sourceSkuKey, itemIds);
      assignments.set(barcode, bySource);
    }
  }

  return [...assignments.entries()]
    .filter(([, bySource]) => bySource.size > 1)
    .map(([barcode, bySource]) => ({
      barcode,
      itemIds: [...new Set([...bySource.values()].flatMap((ids) => [...ids]))],
      sourceSkuKeys: [...bySource.keys()],
    }));
}

function omitBarcodeConflictItems(input: unknown) {
  const state = object(input);
  const conflicts = findCanonicalProductMasterBarcodeConflicts(state);
  if (!conflicts.length) return { state, conflicts };
  const blockedItemIds = new Set(conflicts.flatMap((conflict) => conflict.itemIds));
  return {
    state: {
      ...state,
      items: list(state.items).filter(
        (rawItem) => !blockedItemIds.has(itemIdentity(object(rawItem))),
      ),
    },
    conflicts,
  };
}

export function buildCanonicalProductMasterSnapshot(input: unknown) {
  const built = buildProductMasterSnapshotFromTrackerState(input);
  const state = object(input);
  const sharedBarcodeIdentities = sharedBarcodeIdentityMap(state);
  const identityByBarcode = new Map<
    string,
    { sourceSkuKey: string; skuId: string }
  >();

  for (const rawItem of list(state.items)) {
    const item = object(rawItem);
    if (isSourcingReceiptPending(item)) continue;
    const itemId = text(item.id) || `model:${normalized(item.modelNumber)}`;
    const options = trackerOptions(item);
    const rowBarcode = normalized(item.barcode || item.warehouseLocation);
    for (const [index, rawOption] of options.entries()) {
      const option = object(rawOption);
      const barcode =
        normalized(option.barcode) || (options.length === 1 ? rowBarcode : "");
      if (!barcode) continue;
      const optionId =
        text(option.id) ||
        fallbackOptionIdentity(option.saleOption || option.optionName, index);
      const approvedSharedIdentity = sharedBarcodeIdentities.get(barcode);
      const sourceSkuKey = approvedSharedIdentity
        ? `shared-physical:${approvedSharedIdentity}`
        : `${itemId}:${optionId}`;
      const existing = identityByBarcode.get(barcode);
      if (existing && existing.sourceSkuKey !== sourceSkuKey) {
        throw new Error(
          `TRACKER_BARCODE_CONFLICT:${barcode}:${existing.sourceSkuKey}:${sourceSkuKey}`,
        );
      }
      identityByBarcode.set(barcode, {
        sourceSkuKey,
        skuId: stableSkuId(sourceSkuKey),
      });
    }
  }

  const skuIdMap = new Map<string, string>();
  const skus: StableSku[] = built.payload.skus.map((sku) => {
    const identity = identityByBarcode.get(normalized(sku.barcode));
    const sourceSkuKey =
      identity?.sourceSkuKey ||
      `fallback:${sku.productId}:${normalized(sku.optionName) || "DEFAULT"}`;
    const nextId = identity?.skuId || stableSkuId(sourceSkuKey);
    skuIdMap.set(sku.id, nextId);
    return {
      ...sku,
      id: nextId,
      sourceSystem: SOURCE_SYSTEM,
      sourceSkuKey,
    };
  });

  const remapSkuId = <T extends { skuId: string }>(row: T): T => ({
    ...row,
    skuId: skuIdMap.get(row.skuId) || row.skuId,
  });

  const payload: CanonicalPayload = {
    ...built.payload,
    skus,
    listingMappings: built.payload.listingMappings.map(remapSkuId),
    receiptCosts: built.payload.receiptCosts.map(remapSkuId),
  };
  return { payload, skipped: built.skipped };
}

export function reuseCanonicalProductIds(
  payload: CanonicalPayload,
  catalogProducts: ProductMasterCatalogProduct[],
): CanonicalPayload {
  const existingByModel = new Map<string, string>();
  for (const row of catalogProducts) {
    const modelNo = normalized(row.modelNo);
    const productId = text(row.productId);
    if (!modelNo || !productId) continue;
    const existing = existingByModel.get(modelNo);
    if (existing && existing !== productId) {
      throw new Error(
        `PRODUCT_MASTER_MODEL_IDENTITY_CONFLICT:${modelNo}:${existing}:${productId}`,
      );
    }
    existingByModel.set(modelNo, productId);
  }

  const productIdMap = new Map<string, string>();
  const products = payload.products.map((product) => {
    const productId = existingByModel.get(normalized(product.modelNo)) || product.id;
    productIdMap.set(product.id, productId);
    return productId === product.id ? product : { ...product, id: productId };
  });

  return {
    ...payload,
    products,
    skus: payload.skus.map((sku) => ({
      ...sku,
      productId: productIdMap.get(sku.productId) || sku.productId,
    })),
  };
}

async function loadProductMasterCatalogProducts(baseUrl: string, secret: string) {
  const response = await fetch(`${baseUrl}/api/integrations/inventory-catalog`, {
    headers: {
      "x-commerce-os-integration-secret": secret,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await read(response);
  if (!response.ok) {
    throw new Error(
      `PRODUCT_MASTER_CATALOG_READ_FAILED:${response.status}:${message(body)}`,
    );
  }
  return list(object(body).products).map(object);
}

export async function pushCanonicalProductMasterSnapshotFromTrackerState(
  input: unknown,
  options: { skipBarcodeConflicts?: boolean } = {},
) {
  const secret = process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim();
  if (!secret) throw new Error("PRODUCT_MASTER_INTEGRATION_SECRET_MISSING");
  const baseUrl = (process.env.PRODUCT_MASTER_BASE_URL || PRODUCT_MASTER_URL)
    .trim()
    .replace(/\/$/, "");
  const prepared = options.skipBarcodeConflicts
    ? omitBarcodeConflictItems(input)
    : { state: input, conflicts: [] as ProductMasterBarcodeConflict[] };
  const built = buildCanonicalProductMasterSnapshot(prepared.state);
  const payload = reuseCanonicalProductIds(
    built.payload,
    await loadProductMasterCatalogProducts(baseUrl, secret),
  );
  const counts: Record<string, number> = {};
  const skuById = new Map(
    payload.skus.map((sku) => [sku.id, sku] as const),
  );
  const groups: Array<[keyof CanonicalPayload, unknown[]]> = [
    ["products", payload.products],
    ["skus", payload.skus],
    ["listingMappings", payload.listingMappings],
    ["receiptCosts", payload.receiptCosts],
  ];

  for (const [key, rows] of groups) {
    counts[key] = 0;
    for (let index = 0; index < rows.length; index += BATCH_SIZE) {
      const batch = rows.slice(index, index + BATCH_SIZE);
      const requestPayload: Record<string, unknown> = { [key]: batch };
      if (key === "listingMappings" || key === "receiptCosts") {
        requestPayload.skus = dependentSkuContext(key, batch, skuById);
      }
      const response = await fetch(
        `${baseUrl}/api/integrations/canonical-snapshot`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-commerce-os-integration-secret": secret,
          },
          body: JSON.stringify(requestPayload),
          cache: "no-store",
          signal: AbortSignal.timeout(30_000),
        },
      );
      const body = await read(response);
      if (!response.ok) {
        throw new Error(
          `PRODUCT_MASTER_CANONICAL_SYNC_FAILED:${key}:${response.status}:${message(body)}`,
        );
      }
      counts[key] += batch.length;
      if (body && typeof body === "object" && !Array.isArray(body)) {
        const remoteCounts = object(body).counts;
        if (remoteCounts && typeof remoteCounts === "object" && !Array.isArray(remoteCounts)) {
          counts.skuBarcodeChanges =
            Number(counts.skuBarcodeChanges || 0) +
            Number(object(remoteCounts).sku_barcode_history || 0);
          counts.optionBarcodeIdentities =
            Number(counts.optionBarcodeIdentities || 0) +
            Number(object(remoteCounts).option_barcode_identities || 0);
        }
      }
    }
  }

  return {
    baseUrl,
    counts,
    skipped: built.skipped,
    skippedBarcodeConflicts: prepared.conflicts,
    total: groups.reduce((sum, [, rows]) => sum + rows.length, 0),
  };
}

async function read(response: Response) {
  const body = await response.text();
  if (!body) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

function message(value: unknown) {
  const row = object(value);
  return text(row.message) || text(row.error) || text(value) || "unknown error";
}
