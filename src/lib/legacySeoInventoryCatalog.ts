const DEFAULT_PRODUCT_MASTER_URL =
  "https://commerce-os-product-master.vercel.app";
const SYNTHETIC_PREFIX = "legacy-stock:";

const CONFIRMED_LEGACY_PRODUCTS = [
  ["AAA012", "컬러 실뜯개"],
  ["AAA030", "멀티탭 트레이"],
  ["AAA031", "코뽕 블랙"],
  ["AAA032", "여드름 압출기 8종"],
  ["AAA034", "빈티지 동물 스탬프"],
  ["AAA037", "세면대 거름망 B"],
  ["AAA038", "실리콘 악력볼"],
  ["AAA039", "구리링 보풀제거기"],
  ["AAA040", "거꾸로 양치컵"],
  ["AAA042", "투명코뽕"],
  ["AAA043", "새끼발가락깁스"],
  ["AAA044", "합곡혈 지압기"],
  ["AAA048", "왕챙 썬캡"],
  ["AAA049", "고릴라 인형"],
  ["AAA057", "차량용 CD거치대"],
  ["AAA058", "캥거루 장지갑"],
  ["AAA059", "클러치 지갑"],
  ["AAA065", "뚜껑밀봉클립"],
  ["AAA068", "린넨 선글라스케이스"],
  ["AAA069", "고리형 선글라스케이스"],
  ["AAA071", "스펀지 무소음 농구공"],
  ["AAA074", "실뜯개 끼우기 2in1 색상랜덤"],
  ["AAA074-1", "실끼우는 미니실뜯개 색상랜덤"],
  ["AAA075", "플라워 손목핀쿠션 색상랜덤"],
  ["AAA077", "곰돌이 카고팬츠"],
  ["AAA078", "코털제거기"],
  ["AAA079", "풋브러쉬 색상랜덤 / 등브러쉬 색상랜덤"],
  ["AAA080", "린넨 레이스 앞치마"],
  ["AAA083", "실리콘 도넛악력기 색상랜덤"],
  ["AAA086", "동물 필통"],
  ["AAA090", "꿩안경"],
  ["AAA092", "토끼브로치"],
  ["AAA093", "자동차 브러쉬 케이스포함 / 메이크업브러쉬 케이스포함"],
  ["AAA094", "미니멀 규조토 발매트"],
  ["AAA095", "비듬제거 촘촘빗"],
  ["AAA098", "은박담요 140x210cm"],
  ["AAA103", "차량용 무지 트레블백"],
  ["AAA137", "차량청소브러쉬"],
  ["AAA147", "차량용 원터치 햇빛가리개"],
  ["AAA161", "테이프 미니디스펜서"],
  ["AAA220", "늘어나는 대형샤워볼80g 색상랜덤"],
  ["AAA225", "페이스롤러"],
  ["AAA229", "세면대 거름망 C"],
  ["AAA274", "수제 차키지갑"],
  ["AAA360", "흡착형 샤워기거치대 실버그레이"],
  ["AAA361", "뽀글이 곰돌이 파우치"],
] as const;

export type LegacySeoInventoryListing = {
  goodsKey: string;
  optionId: string;
  channel: string;
  listingName: string;
  listingOptionName: string;
  unitsPerOrder: number;
  active: boolean;
  syncedAt: string;
};

export type LegacySeoInventorySku = {
  skuId: string;
  barcode: string;
  optionName: string;
  chinaOptionName: string;
  optionImageUrl: string;
  supplierUrl: string;
  active: boolean;
  optionBarcodeNo: string;
  optionBarcodeIdentityKey: string;
  latestCostKrw: number;
  currentBasePrice: number;
  listings: LegacySeoInventoryListing[];
};

export type LegacySeoInventoryProduct = {
  productId: string;
  modelNo: string;
  productName: string;
  productNameCn: string;
  category: string;
  status: string;
  mainImageUrl: string;
  origin: string;
  memo: string;
  skus: LegacySeoInventorySku[];
};

type InventoryCatalogPayload = {
  ok?: boolean;
  products?: LegacySeoInventoryProduct[];
  message?: string;
  error?: string;
};

type UnknownRecord = Record<string, unknown>;

export type LegacySeoInventoryCandidate = {
  id: string;
  trackerRowNumber: number | null;
  workBatch: string;
  modelNumber: string;
  productName: string;
  shoplingCategory: string;
  shoplingUploadStatus: string;
  overallStatus: string;
  optionLabels: string[];
  updatedAt: string;
  legacyInventorySource: true;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function normalizeLegacyModel(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

const confirmedNameByModel = new Map<string, string>(CONFIRMED_LEGACY_PRODUCTS);

export function confirmedLegacyInventoryModels() {
  return [...confirmedNameByModel.keys()];
}

export function confirmedLegacyInventoryName(modelNumber: unknown) {
  return confirmedNameByModel.get(normalizeLegacyModel(modelNumber)) ?? "";
}

export function isConfirmedLegacyInventoryModel(modelNumber: unknown) {
  return confirmedNameByModel.has(normalizeLegacyModel(modelNumber));
}

export function legacyInventorySyntheticId(modelNumber: unknown) {
  return `${SYNTHETIC_PREFIX}${normalizeLegacyModel(modelNumber)}`;
}

export function legacyInventoryModelFromSyntheticId(itemId: unknown) {
  const value = text(itemId);
  return value.startsWith(SYNTHETIC_PREFIX)
    ? normalizeLegacyModel(value.slice(SYNTHETIC_PREFIX.length))
    : "";
}

function productMasterConnection() {
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

export async function loadLegacySeoInventoryCatalog() {
  const { baseUrl, secret } = productMasterConnection();
  const response = await fetch(`${baseUrl}/api/integrations/inventory-catalog`, {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-commerce-os-integration-secret": secret,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const payload = (await response.json().catch(() => ({}))) as InventoryCatalogPayload;
  if (!response.ok || payload.ok !== true || !Array.isArray(payload.products)) {
    throw new Error(
      payload.message ||
        payload.error ||
        `PRODUCT_MASTER_INVENTORY_CATALOG_FAILED:${response.status}`,
    );
  }
  return payload.products;
}

export async function loadConfirmedLegacyInventoryProducts() {
  const catalog = await loadLegacySeoInventoryCatalog();
  const byModel = new Map(
    catalog.map((product) => [normalizeLegacyModel(product.modelNo), product] as const),
  );
  return confirmedLegacyInventoryModels().map((modelNo) => {
    const product = byModel.get(modelNo);
    if (product) return product;
    return {
      productId: `legacy-stock-${modelNo.toLowerCase()}`,
      modelNo,
      productName: confirmedLegacyInventoryName(modelNo),
      productNameCn: "",
      category: "",
      status: "ACTIVE",
      mainImageUrl: "",
      origin: "MADE IN CHINA",
      memo: "실재고 사전 확인 기반 이전상품 fallback",
      skus: [],
    } satisfies LegacySeoInventoryProduct;
  });
}

function activeSkus(product: LegacySeoInventoryProduct) {
  const active = product.skus.filter((sku) => sku.active !== false);
  return active.length ? active : product.skus;
}

function activeGoodsKeys(product: LegacySeoInventoryProduct) {
  return [...new Set(
    activeSkus(product).flatMap((sku) =>
      sku.listings
        .filter((listing) => listing.active !== false)
        .map((listing) => text(listing.goodsKey))
        .filter((value) => /^\d{5,12}$/.test(value)),
    ),
  )];
}

export function buildLegacyInventoryItem(product: LegacySeoInventoryProduct): UnknownRecord {
  const modelNumber = normalizeLegacyModel(product.modelNo);
  const skus = activeSkus(product);
  const goodsKeys = activeGoodsKeys(product);
  const optionRows = skus.map((sku, index) => ({
    id: sku.skuId || `legacy-stock-${modelNumber}-${index + 1}`,
    optionName: skus.length > 1 ? "옵션" : "단품",
    saleOption: text(sku.optionName) || "단품",
    chinaOption: text(sku.chinaOptionName),
    barcode: text(sku.barcode),
    baseSalePriceKrw: Math.max(0, Math.round(Number(sku.currentBasePrice) || 0)),
    unitCostKrw: Math.max(0, Math.round(Number(sku.latestCostKrw) || 0)),
    sourceOrderItemId: null,
    optionBarcodeNo: text(sku.optionBarcodeNo),
    optionBarcodeIdentityKey:
      text(sku.optionBarcodeIdentityKey) ||
      (text(sku.barcode) ? `B:${text(sku.barcode)}` : ""),
    optionBarcodeIdentityKind: text(sku.barcode) ? "B_CODE" : "OPTION",
    inventoryCatalogSource: true,
  }));
  const primarySupplierUrl = skus.map((sku) => text(sku.supplierUrl)).find(Boolean) ?? "";
  const shoplingProducts = Object.fromEntries(
    goodsKeys.map((goodsKey) => [goodsKey, { goodsKey }]),
  );
  return {
    id: legacyInventorySyntheticId(modelNumber),
    workBatch: "실재고 사전 이전상품",
    modelNumber,
    productName: text(product.productName) || confirmedLegacyInventoryName(modelNumber),
    shoplingCategory: text(product.category),
    shoplingUploadStatus: "완료",
    overallStatus: "기존 Shopling 상품 · 실재고 사전 확인",
    optionLabels: optionRows.map((row) => row.saleOption),
    orderOptions: optionRows,
    barcode: optionRows.find((row) => row.barcode)?.barcode ?? "",
    mainImageUrl: text(product.mainImageUrl),
    primaryChinaProductLink: primarySupplierUrl,
    chinaProductLinks: primarySupplierUrl ? [primarySupplierUrl] : [],
    shoplingProducts,
    detailPageAssetSource: { goodsKeys },
    stages: {
      shoplingUpload: {
        status: "완료",
        updatedAt: new Date().toISOString(),
      },
    },
    legacyInventorySource: {
      source: "product_master_inventory_catalog",
      productId: product.productId,
      modelNumber,
      goodsKeys,
      status: product.status,
      confirmedAt: "2026-09-08",
    },
  };
}

export function legacyInventoryCandidateFromItem(
  item: UnknownRecord,
  trackerItem?: LegacySeoInventoryCandidate | null,
): LegacySeoInventoryCandidate {
  const modelNumber = normalizeLegacyModel(item.modelNumber);
  const labels = Array.isArray(item.optionLabels)
    ? [...new Set(item.optionLabels.map(text).filter(Boolean))]
    : [];
  return {
    id: trackerItem?.id || text(item.id) || legacyInventorySyntheticId(modelNumber),
    trackerRowNumber: trackerItem?.trackerRowNumber ?? null,
    workBatch: trackerItem?.workBatch || "실재고 사전 이전상품",
    modelNumber,
    productName:
      text(item.productName) || trackerItem?.productName || confirmedLegacyInventoryName(modelNumber),
    shoplingCategory: text(item.shoplingCategory) || trackerItem?.shoplingCategory || "",
    shoplingUploadStatus: "완료",
    overallStatus: trackerItem?.overallStatus || "기존 Shopling 상품 · 실재고 사전 확인",
    optionLabels: labels.length ? labels : trackerItem?.optionLabels || [],
    updatedAt: trackerItem?.updatedAt || "",
    legacyInventorySource: true,
  };
}

export async function loadConfirmedLegacyInventoryItems() {
  const products = await loadConfirmedLegacyInventoryProducts();
  return products.map(buildLegacyInventoryItem);
}
