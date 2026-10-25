import type {
  LegacySeoInventoryProduct,
  LegacySeoInventorySku,
} from "./legacySeoInventoryCatalog.ts";
import { resolveLegacySeoProductMasterOptionAuthority } from "./legacySeoProductMasterOptionAuthority.ts";
import type { LegacySeoShoplingEvidence } from "./legacySeoShoplingEvidence.ts";
import { legacySeoRegistrationExclusion } from "./legacySeoRegistrationPolicy.ts";
import { productLaunchSeoMaterialReadiness } from "./productLaunchSeoMaterialReadiness.ts";
import { isSourcingReceiptPending } from "./sourcingReceiptGate.ts";

type UnknownRecord = Record<string, unknown>;

export type ProductLaunchSeoMaterialRecoveryStatus =
  | "already_ready"
  | "ready_after_recovery"
  | "partially_recovered"
  | "unresolved"
  | "excluded"
  | "receipt_pending"
  | "archived";

export type ProductLaunchSeoMaterialRecoveryPlan = {
  itemId: string;
  modelNumber: string;
  productName: string;
  status: ProductLaunchSeoMaterialRecoveryStatus;
  changed: boolean;
  changedFields: string[];
  patch: UnknownRecord;
  beforeErrors: string[];
  afterErrors: string[];
  warnings: string[];
  unresolved: string[];
};

const ELIGIBLE_PRODUCT_STATUSES = new Set(["ACTIVE", "LAUNCHING"]);
const MANUAL_LOCATION_REVIEW_MODELS = new Set(["AAA480"]);

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function rawText(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function modelKey(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function bCodeKey(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function optionBarcodeKey(value: unknown) {
  return bCodeKey(value).replace(/^OB(?=\d{12}$)/, "");
}

function optionNameKey(value: unknown) {
  return text(value).toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}

function productIdentityKey(value: unknown) {
  return optionNameKey(value).replace(/(?:색상)?랜덤(?:발송)?|단품/g, "");
}

function uniqueUrls(values: unknown[]) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const url = text(value);
    if (!/^https?:\/\//i.test(url)) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(url);
  }
  return result;
}

function activeSkus(product: LegacySeoInventoryProduct) {
  return product.skus.filter((sku) => sku.active !== false);
}

function currentRowConfirmsSingleProductMasterBCode(
  item: UnknownRecord,
  product: LegacySeoInventoryProduct,
) {
  const skus = activeSkus(product);
  if (skus.length !== 1) return false;
  const expected = bCodeKey(skus[0]?.barcode);
  if (!expected) return false;
  return [item.selfCodeBase, item.barcode, item.warehouseLocation]
    .map(bCodeKey)
    .some((value) => value === expected);
}

function eligibleProductForModel(
  product: LegacySeoInventoryProduct | undefined,
  modelNumber: string,
) {
  if (!product || modelKey(product.modelNo) !== modelNumber) return null;
  if (!ELIGIBLE_PRODUCT_STATUSES.has(text(product.status).toUpperCase())) return null;
  return product;
}

function managedShoplingOptions(group: LegacySeoShoplingEvidence["optionGroups"][number]) {
  return group.options.filter(
    (option) => text(option.status).toUpperCase() !== "X" && Boolean(bCodeKey(option.bCode)),
  );
}

function shoplingConfirmsProductMasterOptions(
  product: LegacySeoInventoryProduct,
  evidence: LegacySeoShoplingEvidence | undefined,
) {
  if (!evidence || modelKey(evidence.modelNumber) !== modelKey(product.modelNo)) return false;
  const skus = activeSkus(product);
  if (!skus.length) return false;
  const expectedBCodes = skus.map((sku) => bCodeKey(sku.barcode)).sort();
  return evidence.optionGroups.some((group) => {
    const options = managedShoplingOptions(group);
    if (options.length !== skus.length) return false;
    const actualBCodes = options.map((option) => bCodeKey(option.bCode)).sort();
    return actualBCodes.every((value, index) => value === expectedBCodes[index]);
  });
}

function chooseShoplingAssetGroup(
  evidence: LegacySeoShoplingEvidence | undefined,
  productName: string,
) {
  if (!evidence) return null;
  const candidates = evidence.optionGroups.filter(
    (group) => text(group.detailHtml) || group.imageUrls.length,
  );
  return [...candidates].sort((left, right) => {
    const productKey = productIdentityKey(productName);
    const identityScore = (group: typeof left) => {
      const modelName = productIdentityKey(group.modelName);
      const listingName = productIdentityKey(group.productName);
      if (modelName && (productKey.includes(modelName) || modelName.includes(productKey))) {
        return 20;
      }
      if (listingName && (productKey.includes(listingName) || listingName.includes(productKey))) {
        return 10;
      }
      return 0;
    };
    const identityDifference = identityScore(right) - identityScore(left);
    if (identityDifference) return identityDifference;
    const managedDifference =
      managedShoplingOptions(right).length - managedShoplingOptions(left).length;
    if (managedDifference) return managedDifference;
    const rightScore = (text(right.detailHtml) ? 10 : 0) + right.imageUrls.length;
    const leftScore = (text(left.detailHtml) ? 10 : 0) + left.imageUrls.length;
    if (rightScore !== leftScore) return rightScore - leftScore;
    return (Number(right.goodsKey) || 0) - (Number(left.goodsKey) || 0);
  })[0] ?? null;
}

function chooseShoplingCategory(
  productName: string,
  evidence: LegacySeoShoplingEvidence | undefined,
) {
  if (!evidence) return "";
  const categories = [...new Set(evidence.categories.map(text).filter(Boolean))];
  if (categories.length === 1) return categories[0] ?? "";
  const productKey = productIdentityKey(productName);
  const matchingCategories = [
    ...new Set(
      evidence.optionGroups
        .filter((group) => {
          const modelName = productIdentityKey(group.modelName);
          return Boolean(
            modelName &&
              (productKey.includes(modelName) || modelName.includes(productKey)),
          );
        })
        .map((group) => text(group.category))
        .filter(Boolean),
    ),
  ];
  return matchingCategories.length === 1 ? matchingCategories[0] ?? "" : "";
}

function valueCounts(options: UnknownRecord[], keyOf: (option: UnknownRecord) => string) {
  const counts = new Map<string, number>();
  for (const option of options) {
    const key = keyOf(option);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function uniqueCanonicalIndexes(
  options: UnknownRecord[],
  keyOf: (option: UnknownRecord) => string,
) {
  const indexes = new Map<string, number | null>();
  for (const [index, option] of options.entries()) {
    const key = keyOf(option);
    if (!key) continue;
    indexes.set(key, indexes.has(key) ? null : index);
  }
  return indexes;
}

function alignCurrentOptions(
  currentOptions: UnknownRecord[],
  canonicalOptions: UnknownRecord[],
) {
  if (currentOptions.length !== canonicalOptions.length) return null;
  if (currentOptions.length === 1) {
    const current = currentOptions[0] ?? {};
    const canonical = canonicalOptions[0] ?? {};
    return [{ ...current, ...canonical, id: text(current.id) || text(canonical.id) }];
  }
  const keyResolvers = [
    (option: UnknownRecord) => optionBarcodeKey(option.optionBarcodeNo),
    (option: UnknownRecord) => bCodeKey(option.barcode),
    (option: UnknownRecord) => optionNameKey(option.saleOption ?? option.value),
  ];
  const currentCounts = keyResolvers.map((keyOf) => valueCounts(currentOptions, keyOf));
  const canonicalIndexes = keyResolvers.map((keyOf) =>
    uniqueCanonicalIndexes(canonicalOptions, keyOf),
  );
  const claimed = new Set<number>();
  const aligned = new Array<UnknownRecord>(currentOptions.length);
  for (const [currentIndex, current] of currentOptions.entries()) {
    let canonicalIndex: number | null = null;
    for (const [resolverIndex, keyOf] of keyResolvers.entries()) {
      const key = keyOf(current);
      if (!key || currentCounts[resolverIndex]?.get(key) !== 1) continue;
      const candidate = canonicalIndexes[resolverIndex]?.get(key);
      if (typeof candidate === "number") {
        canonicalIndex = candidate;
        break;
      }
    }
    if (canonicalIndex === null || claimed.has(canonicalIndex)) return null;
    claimed.add(canonicalIndex);
    const canonical = canonicalOptions[canonicalIndex] ?? {};
    aligned[currentIndex] = {
      ...current,
      ...canonical,
      id: text(current.id) || text(canonical.id),
    };
  }
  return aligned;
}

function recoverOptions(input: {
  item: UnknownRecord;
  product: LegacySeoInventoryProduct | null;
  evidence?: LegacySeoShoplingEvidence;
  recoveredAt: string;
}) {
  const currentOptions = array(input.item.orderOptions).map(record);
  if (!input.product) {
    return { options: null, reason: "상품마스터에서 현재 판매 상품을 찾지 못했습니다." };
  }
  const authority = resolveLegacySeoProductMasterOptionAuthority({
    currentOptions,
    product: input.product,
    syncedAt: input.recoveredAt,
  });
  if (!authority.confirmed) {
    return { options: null, reason: authority.reason };
  }

  if (!currentOptions.length) {
    if (MANUAL_LOCATION_REVIEW_MODELS.has(modelKey(input.product.modelNo))) {
      return {
        options: null,
        reason: "기존 위치 기록이 충돌해 실제 창고 위치 확인이 필요합니다.",
      };
    }
    if (
      !shoplingConfirmsProductMasterOptions(input.product, input.evidence) &&
      !currentRowConfirmsSingleProductMasterBCode(input.item, input.product)
    ) {
      return {
        options: null,
        reason: "옵션이 비어 있어 상품마스터와 현재 Shopling B코드의 일치 확인이 필요합니다.",
      };
    }
    return { options: authority.options, reason: "" };
  }

  const aligned = alignCurrentOptions(currentOptions, authority.options);
  if (!aligned) {
    return {
      options: null,
      reason: "기존 옵션과 상품마스터 활성 옵션을 정확히 1:1로 연결하지 못했습니다.",
    };
  }
  return { options: aligned, reason: "" };
}

function recoverDetailAsset(
  item: UnknownRecord,
  product: LegacySeoInventoryProduct | null,
  evidence: LegacySeoShoplingEvidence | undefined,
  recoveredAt: string,
) {
  const current = record(item.detailPageAsset);
  const group = chooseShoplingAssetGroup(evidence, text(item.productName));
  const shoplingImages = uniqueUrls(group?.imageUrls ?? []);
  const currentImages = uniqueUrls(array(current.additionalImageUrls));
  const currentHtml = rawText(current.html);
  const mainImageUrl =
    text(current.mainImageUrl) || text(product?.mainImageUrl) || shoplingImages[0] || "";
  const additionalImageUrls = currentImages.length
    ? currentImages
    : shoplingImages.filter((url) => url !== mainImageUrl).slice(0, 4);
  const html = currentHtml || rawText(group?.detailHtml);
  const changed =
    html !== currentHtml ||
    mainImageUrl !== text(current.mainImageUrl) ||
    additionalImageUrls.join("\n") !== currentImages.join("\n");
  if (!changed) return null;
  return {
    ...current,
    html,
    mainImageUrl,
    additionalImageUrls,
    seoMaterialRecovery: {
      source: [
        product && (text(product.mainImageUrl) || text(product.category))
          ? "product_master_inventory_catalog"
          : "",
        group ? "shopling_live_api" : "",
      ].filter(Boolean),
      goodsKey: text(group?.goodsKey),
      recoveredAt,
    },
  };
}

function statusFor(input: {
  changed: boolean;
  beforeReady: boolean;
  afterReady: boolean;
}): ProductLaunchSeoMaterialRecoveryStatus {
  if (input.beforeReady) return "already_ready";
  if (input.afterReady) return "ready_after_recovery";
  if (input.changed) return "partially_recovered";
  return "unresolved";
}

export function buildProductLaunchSeoMaterialRecoveryPlan(input: {
  item: unknown;
  product?: LegacySeoInventoryProduct;
  evidence?: LegacySeoShoplingEvidence;
  recoveredAt?: string;
}): ProductLaunchSeoMaterialRecoveryPlan {
  const item = record(input.item);
  const itemId = text(item.id);
  const modelNumber = modelKey(item.modelNumber);
  const productName = text(item.productName);
  const before = productLaunchSeoMaterialReadiness(item);
  const base = {
    itemId,
    modelNumber,
    productName,
    changed: false,
    changedFields: [] as string[],
    patch: {} as UnknownRecord,
    beforeErrors: before.errors,
    afterErrors: before.errors,
    warnings: before.warnings,
    unresolved: [] as string[],
  };

  if (text(item.archivedAt)) return { ...base, status: "archived" };
  const exclusion = legacySeoRegistrationExclusion(item);
  if (exclusion.excluded) {
    return { ...base, status: "excluded", unresolved: [exclusion.reason || "SEO 등록 제외"] };
  }
  if (isSourcingReceiptPending(item)) {
    return {
      ...base,
      status: "receipt_pending",
      unresolved: ["신규소싱 상품의 실제 입고확정이 필요합니다."],
    };
  }
  if (before.ready) return { ...base, status: "already_ready" };

  const recoveredAt = input.recoveredAt || new Date().toISOString();
  const product = eligibleProductForModel(input.product, modelNumber);
  const patch: UnknownRecord = {};
  const changedFields: string[] = [];
  const unresolved: string[] = [];

  if (!text(item.shoplingCategory)) {
    const category =
      text(product?.category) || chooseShoplingCategory(productName, input.evidence);
    if (category) {
      patch.shoplingCategory = category;
      changedFields.push("shoplingCategory");
    }
  }

  const detailPageAsset = recoverDetailAsset(
    item,
    product,
    input.evidence,
    recoveredAt,
  );
  if (detailPageAsset) {
    patch.detailPageAsset = detailPageAsset;
    changedFields.push("detailPageAsset");
  }

  const needsOptionRecovery = [...before.errors, ...before.warnings].some((issue) =>
    /옵션|B코드|바코드|판매가|매입가/.test(issue),
  );
  if (needsOptionRecovery) {
    const optionRecovery = recoverOptions({
      item,
      product,
      evidence: input.evidence,
      recoveredAt,
    });
    if (optionRecovery.options) {
      const currentSignature = JSON.stringify(array(item.orderOptions));
      const nextSignature = JSON.stringify(optionRecovery.options);
      if (currentSignature !== nextSignature) {
        patch.orderOptions = optionRecovery.options;
        changedFields.push("orderOptions");
      }
    } else {
      unresolved.push(optionRecovery.reason);
    }
  }

  const changed = changedFields.length > 0;
  if (changed) {
    patch.seoMaterialRecovery = {
      source: [
        product ? "product_master_inventory_catalog" : "",
        input.evidence ? "shopling_live_api" : "",
      ].filter(Boolean),
      recoveredAt,
      changedFields,
    };
  }
  const nextItem = changed ? { ...item, ...patch } : item;
  const after = productLaunchSeoMaterialReadiness(nextItem);
  return {
    itemId,
    modelNumber,
    productName,
    status: statusFor({ changed, beforeReady: before.ready, afterReady: after.ready }),
    changed,
    changedFields,
    patch,
    beforeErrors: before.errors,
    afterErrors: after.errors,
    warnings: after.warnings,
    unresolved: [...new Set([...unresolved, ...after.errors])],
  };
}

export function productLaunchSeoRecoveryNeedsShoplingEvidence(
  itemInput: unknown,
  product?: LegacySeoInventoryProduct,
) {
  const item = record(itemInput);
  const detail = record(item.detailPageAsset);
  const manualLocationReview = Boolean(
    product && MANUAL_LOCATION_REVIEW_MODELS.has(modelKey(product.modelNo)),
  );
  const hasActiveProductMasterOptions = Boolean(product && activeSkus(product).length);
  const exactSingleBCode = Boolean(
    product &&
      !manualLocationReview &&
      currentRowConfirmsSingleProductMasterBCode(item, product),
  );
  return (
    !text(detail.html) ||
    (!text(detail.mainImageUrl) && !text(product?.mainImageUrl)) ||
    (array(item.orderOptions).length === 0 &&
      hasActiveProductMasterOptions &&
      !manualLocationReview &&
      !exactSingleBCode)
  );
}

export function activeProductMasterSkus(product: LegacySeoInventoryProduct | undefined) {
  return product ? activeSkus(product) : ([] as LegacySeoInventorySku[]);
}
