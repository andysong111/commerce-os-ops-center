import { applyLegacySeoCanonicalPrices } from "@/lib/legacySeoCanonicalPrice";
import { readDuplicateActiveLegacySeoModels } from "@/lib/legacySeoDuplicateModelGuard";
import { legacySeoRegistrationExclusion } from "@/lib/legacySeoRegistrationPolicy";
import { recoverLegacySeoShoplingAssets } from "@/lib/legacySeoShoplingAssetRecovery";
import { syncLegacySeoShoplingOptions } from "@/lib/legacySeoShoplingOptionSync";
import { readProductLaunchNormalizedItems } from "@/lib/productLaunchTrackerNormalizedStore";
import type {
  ProductLaunchAdminConfig,
  ProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";

type UnknownRecord = Record<string, unknown>;

export type LegacySeoPreflightIssue = {
  itemId: string;
  modelNumber: string;
  field: string;
  message: string;
};

export type LegacySeoPreflightItem = {
  itemId: string;
  modelNumber: string;
  ready: boolean;
  excluded: boolean;
  issues: LegacySeoPreflightIssue[];
};

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

function modelKey(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function optionBarcodeNoValid(value: unknown) {
  return /^(?:OB)?\d{12}$/.test(text(value).toUpperCase());
}

function syncedFromCurrentShopling(item: UnknownRecord) {
  const itemSync = record(item.shoplingOptionSync);
  if (
    text(itemSync.source) === "shopling_live_grouped_option_sync" &&
    text(itemSync.status) === "synced"
  ) {
    return true;
  }
  const options = array(item.orderOptions).map(record);
  return (
    options.length > 0 &&
    options.every(
      (option) =>
        text(record(option.shoplingOptionSync).source) ===
        "shopling_live_grouped_option_sync",
    )
  );
}

function validateItem(item: UnknownRecord): LegacySeoPreflightIssue[] {
  const itemId = text(item.id);
  const modelNumber = modelKey(item.modelNumber);
  const issues: LegacySeoPreflightIssue[] = [];
  const push = (field: string, message: string) =>
    issues.push({ itemId, modelNumber, field, message });

  if (!syncedFromCurrentShopling(item)) {
    push("shoplingOptions", "현재 Shopling 옵션/B코드와 동기화가 확인되지 않았습니다.");
  }

  const options = array(item.orderOptions).map(record);
  if (!options.length) {
    push("options", "Shopling 등록용 옵션이 없습니다.");
  }
  for (const [index, option] of options.entries()) {
    const saleOption = text(option.saleOption ?? option.value) || `${index + 1}번째 옵션`;
    if (!text(option.saleOption ?? option.value)) {
      push("saleOption", `${saleOption}: 판매옵션명이 없습니다.`);
    }
    if (!text(option.barcode)) {
      push("bCode", `${saleOption}: B코드가 없습니다.`);
    }
    if (!optionBarcodeNoValid(option.optionBarcodeNo)) {
      push("optionBarcodeNo", `${saleOption}: 옵션바코드NO 숫자 12자리가 없습니다.`);
    }
    if (positiveNumber(option.baseSalePriceKrw) <= 0) {
      push("salePrice", `${saleOption}: 중국주문 최종확정 판매가가 없습니다.`);
    }
    if (positiveNumber(option.unitCostKrw) <= 0) {
      push("unitCost", `${saleOption}: 중국주문 최종확정 원가가 없습니다.`);
    }
  }

  const detail = record(item.detailPageAsset);
  if (!text(detail.html)) push("detailHtml", "상세페이지 HTML이 없습니다.");
  if (!text(detail.mainImageUrl)) push("mainImage", "대표이미지가 없습니다.");
  const additional = array(detail.additionalImageUrls).map(text).filter(Boolean);
  if (!additional.length) push("additionalImages", "부가이미지가 1장 이상 필요합니다.");

  return issues;
}

export async function prepareLegacySeoPreflight(input: {
  config: ProductLaunchAdminConfig;
  identity: ProductLaunchIdentity;
  itemIds: string[];
}) {
  const itemIds = [...new Set(input.itemIds.map(text).filter(Boolean))].slice(0, 100);
  let items = (await readProductLaunchNormalizedItems(
    input.config,
    input.identity.userId,
    itemIds,
  )).map(record);
  const initialById = new Map(items.map((item) => [text(item.id), item]));
  const models = [...new Set(
    itemIds
      .map((id) => initialById.get(id))
      .filter((item): item is UnknownRecord => Boolean(item))
      .filter((item) => !legacySeoRegistrationExclusion(item).excluded)
      .map((item) => modelKey(item.modelNumber))
      .filter(Boolean),
  )].slice(0, 100);

  let duplicateModelGuardError = "";
  let duplicateActiveModels = new Map<
    string,
    { modelNumber: string; itemIds: string[]; productNames: string[] }
  >();
  if (models.length) {
    try {
      duplicateActiveModels = await readDuplicateActiveLegacySeoModels({
        config: input.config,
        ownerId: input.identity.userId,
        requestedModels: models,
      });
    } catch (error) {
      duplicateModelGuardError = error instanceof Error ? error.message : String(error);
    }
  }
  const canonicalModels = duplicateModelGuardError
    ? []
    : models.filter((modelNumber) => !duplicateActiveModels.has(modelNumber));

  let optionSyncError = "";
  let optionSync: UnknownRecord | null = null;
  if (models.length) {
    try {
      optionSync = record(
        await syncLegacySeoShoplingOptions({
          config: input.config,
          identity: input.identity,
          modelNumbers: models,
        }),
      );
    } catch (error) {
      optionSyncError = error instanceof Error ? error.message : String(error);
    }
  }

  items = (await readProductLaunchNormalizedItems(
    input.config,
    input.identity.userId,
    itemIds,
  )).map(record);

  let assetRecoveryError = "";
  let assetRecovery: Awaited<ReturnType<typeof recoverLegacySeoShoplingAssets>> | null = null;
  if (!optionSyncError && items.length) {
    try {
      assetRecovery = await recoverLegacySeoShoplingAssets({
        config: input.config,
        identity: input.identity,
        items,
      });
    } catch (error) {
      assetRecoveryError = error instanceof Error ? error.message : String(error);
    }
  }

  items = (await readProductLaunchNormalizedItems(
    input.config,
    input.identity.userId,
    itemIds,
  )).map(record);

  let canonicalPriceError = "";
  let canonicalPrice: Awaited<ReturnType<typeof applyLegacySeoCanonicalPrices>> | null = null;
  if (!optionSyncError && canonicalModels.length) {
    try {
      canonicalPrice = await applyLegacySeoCanonicalPrices({
        config: input.config,
        identity: input.identity,
        modelNumbers: canonicalModels,
      });
    } catch (error) {
      canonicalPriceError = error instanceof Error ? error.message : String(error);
    }
  }

  items = (await readProductLaunchNormalizedItems(
    input.config,
    input.identity.userId,
    itemIds,
  )).map(record);
  const itemById = new Map(items.map((item) => [text(item.id), item]));
  const canonicalByModel = new Map(
    (canonicalPrice?.results ?? []).map((result) => [modelKey(result.modelNumber), result] as const),
  );
  const assetIssuesByModel = new Map<string, string[]>();
  for (const issue of assetRecovery?.unresolved ?? []) {
    const modelNumber = modelKey(issue.modelNumber);
    const values = assetIssuesByModel.get(modelNumber) ?? [];
    values.push(issue.reason);
    assetIssuesByModel.set(modelNumber, values);
  }
  const results: LegacySeoPreflightItem[] = [];

  for (const itemId of itemIds) {
    const item = itemById.get(itemId);
    if (!item) {
      results.push({
        itemId,
        modelNumber: "",
        ready: false,
        excluded: false,
        issues: [{ itemId, modelNumber: "", field: "item", message: "출시 상품을 찾지 못했습니다." }],
      });
      continue;
    }
    const modelNumber = modelKey(item.modelNumber);
    const exclusion = legacySeoRegistrationExclusion(item);
    const canonical = canonicalByModel.get(modelNumber);
    const duplicateActiveModel = duplicateActiveModels.get(modelNumber);
    const issues: LegacySeoPreflightIssue[] = [];
    const add = (field: string, message: string) =>
      issues.push({ itemId, modelNumber, field, message });

    if (exclusion.excluded) {
      add("policy", exclusion.reason || "이전상품 SEO 등록 제외 정책");
    }
    if (optionSyncError) add("shoplingOptions", `Shopling 옵션 동기화 실패: ${optionSyncError}`);
    if (assetRecoveryError) add("detailAssets", `Shopling 상세/이미지 복구 실패: ${assetRecoveryError}`);
    for (const reason of assetIssuesByModel.get(modelNumber) ?? []) {
      add("detailAssets", reason);
    }

    if (!exclusion.excluded) {
      if (duplicateModelGuardError) {
        add(
          "canonicalPrice",
          `중복 모델번호 안전검사 실패로 가격 적용을 차단했습니다: ${duplicateModelGuardError}`,
        );
      } else if (duplicateActiveModel) {
        const names = duplicateActiveModel.productNames.filter(Boolean).join(" / ");
        add(
          "canonicalPrice",
          `동일 모델번호로 활성 상품이 ${duplicateActiveModel.itemIds.length}개 존재하여 자동 가격 매칭을 차단했습니다${names ? ` (${names})` : ""}.`,
        );
      } else {
        if (canonicalPriceError) {
          add("canonicalPrice", `중국주문 최종가격 적용 실패: ${canonicalPriceError}`);
        }
        if (!canonicalPrice?.batchReady) {
          const firstReason = canonical?.unresolved?.[0]?.reason;
          add("canonicalPrice", firstReason || "중국주문 최종가격 원장이 완전 적재되지 않았습니다.");
        } else if (canonical?.excluded) {
          add("canonicalPrice", canonical.excludedReason || "중국주문 최종확정표 단종/적용제외");
        } else if (canonical && canonical.unresolved.length) {
          for (const issue of canonical.unresolved) {
            add("canonicalPrice", `${issue.saleOption ? `${issue.saleOption}: ` : ""}${issue.reason}`);
          }
        } else if (!canonical) {
          add("canonicalPrice", "중국주문 최종확정표에서 모델을 찾지 못했습니다.");
        }
      }
    }

    if (!exclusion.excluded && !canonical?.excluded) {
      issues.push(...validateItem(item));
    }
    const excluded = exclusion.excluded || Boolean(canonical?.excluded);
    results.push({
      itemId,
      modelNumber,
      ready: !excluded && issues.length === 0,
      excluded,
      issues,
    });
  }

  const issueCount = results.reduce((sum, result) => sum + result.issues.length, 0);
  return {
    ok: results.length > 0 && results.every((result) => result.ready || result.excluded),
    requestedCount: itemIds.length,
    readyCount: results.filter((result) => result.ready).length,
    excludedCount: results.filter((result) => result.excluded).length,
    failedCount: results.filter((result) => !result.ready && !result.excluded).length,
    issueCount,
    duplicateModelGuardError,
    duplicateActiveModels: [...duplicateActiveModels.values()],
    optionSync,
    optionSyncError,
    assetRecovery,
    assetRecoveryError,
    canonicalPrice,
    canonicalPriceError,
    items,
    results,
  };
}
