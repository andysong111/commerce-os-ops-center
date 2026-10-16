import { isSourcingReceiptPending } from "./sourcingReceiptGate.ts";
import { isPurchaseOptionDiscontinued } from "./userChinaPurchaseRules20261017.ts";

type R = Record<string, unknown>;

type Product = {
  id: string;
  modelNo: string;
  productNameKo: string;
  productNameCn?: string | null;
  category?: string | null;
  status: "LAUNCHING" | "ACTIVE" | "PAUSED" | "DISCONTINUED";
  mainImageUrl?: string | null;
  origin: string;
  hsCode?: string | null;
  isSeasonal: boolean;
  isStrategic: boolean;
  memo?: string | null;
};

type Sku = {
  id: string;
  productId: string;
  barcode: string;
  optionBarcodeNo?: string | null;
  optionBarcodeIdentityKey?: string | null;
  optionName: string;
  chinaOptionName?: string | null;
  optionImageUrl?: string | null;
  labelText?: string | null;
  packagingGrade: number;
  moq: number;
  cartonQuantity: number;
  supplierUrl?: string | null;
  leadTimeDays: number;
  targetStockDays: number;
  memo?: string | null;
  active: boolean;
};

type Listing = {
  id: string;
  skuId: string;
  goodsKey?: string | null;
  optionId?: string | null;
  channel?: string | null;
  listingName?: string | null;
  listingOptionName?: string | null;
  unitsPerOrder: number;
  active: boolean;
  syncedAt?: string | null;
};

type ReceiptCost = {
  id: string;
  skuId: string;
  quantity: number;
  unitCostKrw: number;
  receivedAt: string;
  source: string;
  externalId?: string | null;
};

export type ProductMasterSnapshotPayload = {
  products: Product[];
  skus: Sku[];
  listingMappings: Listing[];
  inventoryMovements: never[];
  salesMonthly: never[];
  receiptCosts: ReceiptCost[];
  decisions: never[];
};

export type ProductMasterSyncBuildResult = {
  payload: ProductMasterSnapshotPayload;
  skipped: {
    missingModelNumber: number;
    missingBarcode: number;
    receiptWithoutSku: number;
    sourcingReceiptPending: number;
  };
};

const PRODUCT_MASTER_URL = "https://commerce-os-product-master.vercel.app";
const CHANNELS: Record<string, string> = {
  wholesale1: "도매1",
  wholesale2: "도매2",
  wholesale3: "도매3",
  wholesale4: "도매4",
  retail1: "소매1",
  retail2: "소매2",
};
const COMPLETED = new Set(["완료", "제외"]);
const BATCH_SIZE = 500;

export function buildProductMasterSnapshotFromTrackerState(
  input: unknown,
): ProductMasterSyncBuildResult {
  const state = object(input);
  const products = new Map<string, Product>();
  const skus = new Map<string, Sku>();
  const listings = new Map<string, Listing>();
  const skipped = {
    missingModelNumber: 0,
    missingBarcode: 0,
    receiptWithoutSku: 0,
    sourcingReceiptPending: 0,
  };

  for (const rawItem of list(state.items)) {
    const item = object(rawItem);
    if (isSourcingReceiptPending(item)) {
      skipped.sourcingReceiptPending += 1;
      continue;
    }
    const modelNo = normalized(item.modelNumber);
    const productName = text(item.productName);
    if (!modelNo) {
      skipped.missingModelNumber += 1;
      continue;
    }

    const productId = id("product", modelNo);
    const archived = Boolean(item.archivedAt);
    const asset = object(item.detailPageAsset);
    products.set(productId, {
      id: productId,
      modelNo,
      productNameKo: productName || modelNo,
      productNameCn: optional(item.productNameCn),
      category: optional(item.shoplingCategory),
      status: productStatus(item, archived),
      mainImageUrl: optional(asset.mainImageUrl),
      origin: "MADE IN CHINA",
      hsCode: optional(item.hsCode),
      isSeasonal: Boolean(item.isSeasonal),
      isStrategic: Boolean(item.isStrategic),
      memo: optional(item.notes),
    });

    const options = orderOptions(item);
    const rowBarcode = normalized(item.barcode || item.warehouseLocation);
    for (const [index, rawOption] of options.entries()) {
      const option = object(rawOption);
      const barcode =
        normalized(option.barcode) || (options.length === 1 ? rowBarcode : "");
      if (!barcode) {
        skipped.missingBarcode += 1;
        continue;
      }

      const skuId = id("sku", barcode);
      const optionName =
        text(option.saleOption) || text(option.optionName) || `옵션 ${index + 1}`;
      skus.set(skuId, {
        id: skuId,
        productId,
        barcode,
        optionBarcodeNo: optional(option.optionBarcodeNo),
        optionBarcodeIdentityKey: optional(option.optionBarcodeIdentityKey),
        optionName,
        chinaOptionName: optional(option.chinaOption),
        optionImageUrl: optional(option.optionImageUrl),
        labelText: optional(item.labelText),
        packagingGrade: bounded(item.packagingGrade, 1, 5, 3),
        moq: positive(option.moq ?? item.moq, 1),
        cartonQuantity: positive(
          option.cartonQuantity ?? item.cartonQuantity,
          1,
        ),
        supplierUrl: supplierUrl(item),
        leadTimeDays: nonNegative(item.leadTimeDays, 14),
        targetStockDays: nonNegative(item.targetStockDays, 30),
        memo: optional(item.notes),
        active: !archived && !isPurchaseOptionDiscontinued(option),
      });

      const shopling = object(item.shoplingProducts);
      for (const [channelKey, channelName] of Object.entries(CHANNELS)) {
        const channel = object(shopling[channelKey]);
        const goodsKey = text(channel.goodsKey);
        if (!goodsKey) continue;
        const mappingId = id("listing", `${barcode}:${channelKey}:${goodsKey}`);
        listings.set(mappingId, {
          id: mappingId,
          skuId,
          goodsKey,
          optionId: optional(option.optionId),
          channel: channelName,
          listingName: productName || modelNo,
          listingOptionName: optionName,
          unitsPerOrder: inferUnitsPerOrder(optionName),
          active: !archived && !isPurchaseOptionDiscontinued(option),
          syncedAt:
            iso(channel.registeredAt) || iso(item.updatedAt) || new Date().toISOString(),
        });
      }
    }
  }

  const receiptCosts: ReceiptCost[] = [];
  const cache = object(state.priceAdjustmentReceiptCache);
  const byBarcode = object(cache.receiptsByBarcode);
  const skuByBarcode = new Map(
    [...skus.values()].map((sku) => [normalized(sku.barcode), sku]),
  );
  for (const [rawBarcode, rawRows] of Object.entries(byBarcode)) {
    const sku = skuByBarcode.get(normalized(rawBarcode));
    if (!sku) {
      skipped.receiptWithoutSku += list(rawRows).length;
      continue;
    }
    for (const rawRow of list(rawRows)) {
      const row = object(rawRow);
      const sourceId = text(row.id) || text(row.externalId);
      const receivedAt = iso(row.receivedAt);
      const unitCostKrw = nonNegative(row.unitCostKrw, 0);
      if (!sourceId || !receivedAt || unitCostKrw <= 0) continue;
      receiptCosts.push({
        id: id("receipt", sourceId),
        skuId: sku.id,
        quantity: nonNegativeNumber(row.quantity, 0),
        unitCostKrw,
        receivedAt,
        source: "ops_center_confirmed_receipt_cache",
        externalId: sourceId,
      });
    }
  }

  return {
    payload: {
      products: [...products.values()],
      skus: [...skus.values()],
      listingMappings: [...listings.values()],
      inventoryMovements: [],
      salesMonthly: [],
      receiptCosts,
      decisions: [],
    },
    skipped,
  };
}

export async function pushProductMasterSnapshotFromTrackerState(input: unknown) {
  const secret = process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim();
  if (!secret) throw new Error("PRODUCT_MASTER_INTEGRATION_SECRET_MISSING");
  const baseUrl = (process.env.PRODUCT_MASTER_BASE_URL || PRODUCT_MASTER_URL)
    .trim()
    .replace(/\/$/, "");
  const built = buildProductMasterSnapshotFromTrackerState(input);
  const counts: Record<string, number> = {};
  const groups: Array<[keyof ProductMasterSnapshotPayload, unknown[]]> = [
    ["products", built.payload.products],
    ["skus", built.payload.skus],
    ["listingMappings", built.payload.listingMappings],
    ["receiptCosts", built.payload.receiptCosts],
  ];

  for (const [key, rows] of groups) {
    counts[key] = 0;
    for (let index = 0; index < rows.length; index += BATCH_SIZE) {
      const batch = rows.slice(index, index + BATCH_SIZE);
      const response = await fetch(`${baseUrl}/api/integrations/snapshots`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-commerce-os-integration-secret": secret,
        },
        body: JSON.stringify({ [key]: batch }),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
      const responseBody = await read(response);
      if (!response.ok) {
        throw new Error(
          `PRODUCT_MASTER_SYNC_FAILED:${key}:${response.status}:${message(responseBody)}`,
        );
      }
      counts[key] += batch.length;
    }
  }

  return {
    baseUrl,
    counts,
    skipped: built.skipped,
    total: groups.reduce((sum, [, rows]) => sum + rows.length, 0),
  };
}

export function inferUnitsPerOrder(value: unknown) {
  const name = text(value).normalize("NFKC");
  if (!name) return 1;
  if (/(^|[\s,/+_-])(단품|낱개|1\s*개)(?=$|[\s,/+_-])/i.test(name)) {
    return 1;
  }
  const patterns = [
    /(?:^|[\s,/+_-])(\d{1,4})\s*(?:개|매|입|P|PCS|EA)\s*(?:세트|SET|묶음|팩|PACK|포장|구성|들이)?(?=$|[\s,/+_-])/i,
    /(\d{1,4})\s*(?:개|매|입|P|PCS|EA)\s*(?:세트|SET|묶음|팩|PACK|포장|구성|들이)/i,
    /(?:세트|SET|묶음|팩|PACK|포장|구성)\s*(\d{1,4})\s*(?:개|매|입|P|PCS|EA)?/i,
  ];
  for (const pattern of patterns) {
    const matched = name.match(pattern);
    if (matched) return bounded(matched[1], 1, 10_000, 1);
  }
  return 1;
}

function orderOptions(item: R): R[] {
  const current = list(item.orderOptions).map(object);
  if (current.length) return current;
  const legacy = list(item.options).map((value, index) => ({
    id: `legacy-${index + 1}`,
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

function productStatus(item: R, archived: boolean): Product["status"] {
  if (archived) return "PAUSED";
  const statuses = Object.values(object(item.stages)).map((value) =>
    text(object(value).status),
  );
  return statuses.length && statuses.every((status) => COMPLETED.has(status))
    ? "ACTIVE"
    : "LAUNCHING";
}

function supplierUrl(item: R) {
  const primary = text(item.primaryChinaProductLink);
  if (primary) return primary;
  const candidate = list(item.chinaProductLinks).map(text).find(Boolean);
  if (candidate) return candidate;
  return optional(object(item.detailPageSource).primaryUrl);
}

function object(value: unknown): R {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as R)
    : {};
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function text(value: unknown) {
  return String(value ?? "").trim();
}
function optional(value: unknown) {
  return text(value) || null;
}
function normalized(value: unknown) {
  return text(value).normalize("NFKC").replace(/\s+/g, "").toUpperCase();
}
function id(prefix: string, value: string) {
  return `${prefix}:${encodeURIComponent(normalized(value))}`;
}
function positive(value: unknown, fallback: number) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}
function nonNegative(value: unknown, fallback: number) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
function nonNegativeNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
function bounded(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}
function iso(value: unknown) {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
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
