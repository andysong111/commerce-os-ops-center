import type { LegacySeoInventoryProduct } from "./legacySeoInventoryCatalog.ts";
import { reserveUniqueLegacySeoOptionId } from "./legacySeoUniqueOptionId.ts";

type UnknownRecord = Record<string, unknown>;

export type LegacySeoProductMasterOptionAuthority = {
  confirmed: boolean;
  reason: string;
  options: UnknownRecord[];
};

const ELIGIBLE_PRODUCT_STATUSES = new Set(["ACTIVE", "LAUNCHING"]);
const MANAGED_LOCATION_PATTERN = /^(?:B[A-Z]{2}|TMP)\d+-\d+$/;
const OPTION_BARCODE_PATTERN = /^(?:OB)?\d{12}$/;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function modelKey(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function barcodeKey(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function optionBarcodeKey(value: unknown) {
  return barcodeKey(value).replace(/^OB(?=\d{12}$)/, "");
}

function uniqueOptionMap(
  options: UnknownRecord[],
  keyOf: (option: UnknownRecord) => string,
) {
  const result = new Map<string, UnknownRecord | null>();
  for (const option of options) {
    const key = keyOf(option);
    if (!key) continue;
    result.set(key, result.has(key) ? null : option);
  }
  return result;
}

function reject(reason: string): LegacySeoProductMasterOptionAuthority {
  return { confirmed: false, reason, options: [] };
}

export function resolveLegacySeoProductMasterOptionAuthority(input: {
  currentOptions: UnknownRecord[];
  product: LegacySeoInventoryProduct;
  syncedAt: string;
}): LegacySeoProductMasterOptionAuthority {
  const { currentOptions, product, syncedAt } = input;
  const modelNumber = modelKey(product.modelNo);
  const status = text(product.status).toUpperCase();
  if (!modelNumber) return reject("상품마스터 모델번호 없음");
  if (!ELIGIBLE_PRODUCT_STATUSES.has(status)) {
    return reject(`상품마스터 판매상태 아님: ${status || "미입력"}`);
  }

  const skus = product.skus.filter((sku) => sku.active !== false);
  if (!skus.length) return reject("상품마스터 활성 옵션 없음");

  const bCodes = skus.map((sku) => barcodeKey(sku.barcode));
  const optionBarcodeNos = skus.map((sku) => barcodeKey(sku.optionBarcodeNo));
  const optionBarcodeKeys = optionBarcodeNos.map(optionBarcodeKey);
  const identityKeys = skus.map(
    (sku, index) => text(sku.optionBarcodeIdentityKey) || `B:${bCodes[index]}`,
  );

  for (const [index, sku] of skus.entries()) {
    const label = text(sku.optionName);
    if (!label) return reject(`${index + 1}번째 상품마스터 판매옵션명 없음`);
    if (!MANAGED_LOCATION_PATTERN.test(bCodes[index] ?? "")) {
      return reject(`${label}: 관리 가능한 B코드 없음`);
    }
    if (!OPTION_BARCODE_PATTERN.test(optionBarcodeNos[index] ?? "")) {
      return reject(`${label}: 12자리 옵션바코드NO 없음`);
    }
    if (!identityKeys[index]) return reject(`${label}: 옵션바코드 식별값 없음`);
  }

  if (new Set(bCodes).size !== bCodes.length) return reject("상품마스터 B코드 중복");
  if (new Set(optionBarcodeKeys).size !== optionBarcodeKeys.length) {
    return reject("상품마스터 옵션바코드NO 중복");
  }
  if (new Set(identityKeys).size !== identityKeys.length) {
    return reject("상품마스터 옵션바코드 식별값 중복");
  }

  const currentByOptionBarcode = uniqueOptionMap(currentOptions, (option) =>
    optionBarcodeKey(option.optionBarcodeNo),
  );
  const currentByBCode = uniqueOptionMap(currentOptions, (option) =>
    barcodeKey(option.barcode),
  );
  const claimedOptionIds = new Set<string>();
  const optionName = skus.length === 1 ? "단품" : "옵션";
  const options = skus.map((sku, index) => {
    const bCode = bCodes[index] ?? "";
    const optionBarcodeNo = optionBarcodeNos[index] ?? "";
    const matched =
      currentByOptionBarcode.get(optionBarcodeKey(optionBarcodeNo)) ||
      currentByBCode.get(bCode) ||
      {};
    const matchedRecord = record(matched);
    const identityKey = identityKeys[index] ?? `B:${bCode}`;
    const optionId = reserveUniqueLegacySeoOptionId(
      text(matchedRecord.id),
      `product-master-${modelNumber.toLowerCase()}-${index + 1}`,
      claimedOptionIds,
    );
    const catalogBaseSalePriceKrw = Math.max(
      0,
      Math.floor(Number(sku.currentBasePrice) || 0),
    );
    const catalogUnitCostKrw = Math.max(
      0,
      Math.floor(Number(sku.latestCostKrw) || 0),
    );
    return {
      ...matchedRecord,
      id: optionId,
      optionName,
      saleOption: text(sku.optionName),
      chinaOption: text(sku.chinaOptionName),
      barcode: bCode,
      baseSalePriceKrw:
        catalogBaseSalePriceKrw ||
        Math.max(0, Math.ceil(Number(matchedRecord.baseSalePriceKrw) || 0)),
      unitCostKrw:
        catalogUnitCostKrw ||
        Math.max(0, Math.ceil(Number(matchedRecord.unitCostKrw) || 0)),
      sourceOrderItemId:
        matchedRecord.sourceOrderItemId === undefined
          ? null
          : matchedRecord.sourceOrderItemId,
      optionBarcodeNo,
      optionBarcodeIdentityKey: identityKey,
      optionBarcodeIdentityKind: identityKey.startsWith("B:") ? "B_CODE" : "OPTION",
      inventoryCatalogSource: true,
      productMasterOptionAuthority: {
        source: "product_master_inventory_catalog",
        productId: text(product.productId),
        skuId: text(sku.skuId),
        modelNumber,
        status,
        syncedAt,
      },
    };
  });

  return {
    confirmed: true,
    reason: "상품마스터 현재 활성 옵션/B코드 기준",
    options,
  };
}
