import { applyLegacySeoCanonicalPrices } from "@/lib/legacySeoCanonicalPrice";
import { readDuplicateActiveLegacySeoModels } from "@/lib/legacySeoDuplicateModelGuard";
import {
  legacySeoRegistrationExclusion,
  legacySeoRegistrationExclusionFromPolicy,
} from "@/lib/legacySeoRegistrationPolicy";
import { recoverLegacySeoShoplingAssets } from "@/lib/legacySeoShoplingAssetRecovery";
import { syncLegacySeoShoplingOptions } from "@/lib/legacySeoShoplingOptionSync";
import { legacySeoShoplingSyncConfirmed } from "@/lib/legacySeoShoplingSyncState";
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

const CANONICAL_PRICE_SOURCE = "china_order_final_confirmed_v4";
const CANONICAL_PRICE_REVISION = "20260809_v4_option_max_uniform";

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

function canonicalPriceConfirmed(option: UnknownRecord) {
  const canonical = record(option.canonicalChinaPrice);
  if (
    text(canonical.source) !== CANONICAL_PRICE_SOURCE ||
    text(canonical.sourceRevision) !== CANONICAL_PRICE_REVISION
  ) {
    return false;
  }
  const currentSale = Math.round(positiveNumber(option.baseSalePriceKrw));
  const currentCost = Math.round(positiveNumber(option.unitCostKrw));
  const canonicalSale = Math.round(positiveNumber(canonical.finalSalePriceKrw));
  const canonicalCost = Math.round(
    positiveNumber(canonical.unitCostKrwMirror) ||
      positiveNumber(canonical.unitCostKrwExact),
  );
  return (
    currentSale > 0 &&
    currentCost > 0 &&
    currentSale === canonicalSale &&
    currentCost === canonicalCost
  );
}

function syncedFromCurrentShopling(item: UnknownRecord) {
  return legacySeoShoplingSyncConfirmed(item);
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
    if (!canonicalPriceConfirmed(option)) {
      push(
        "canonicalPriceAuthority",
        `${saleOption}: 중국주문 최종확정 v4 적용근거와 현재 가격이 일치하지 않습니다.`,
      );
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

  // Missing normalized options are recoverable and must not be excluded before
  // Shopling synchronization. Only an explicit stored exclusion policy is allowed
  // to prevent the recovery attempt at this stage.
  const models = [...new Set(
    itemIds
      .map((id) => initialById.get(id))
      .filter((item): item is UnknownRecord => Boolean(item))
      .filter(
        (item) =>
          !legacySeoRegistrationExclusionFromPolicy(item.legacySeoRegistrationPolicy).excluded,
      )
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
  const duplicateSafeModels = duplicateModelGuardError
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

  const optionSyncByModel = new Map<string, UnknownRecord>();
  for (const value of array(optionSync?.results)) {
    const result = record(value);
    const modelNumber = modelKey(result.modelNumber);
    if (modelNumber) optionSyncByModel.set(modelNumber, result);
  }

  items = (await readProductLaunchNormalizedItems(
    input.config,
    input.identity.userId,
    itemIds,
  )).map(record);

  let assetRecoveryError = "";
  let assetRecovery: Awaited<ReturnType<typeof recoverLegacySeoShoplingAssets>> | null = null;
  if (items.length) {
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

  // Canonical price writes are allowed only after the same model has a confirmed
  // current-Shopling option set. A single failed model can no longer block every
  // other model in the batch, while an unconfirmed model remains fail-closed.
  const priceEligibleModels = new Set(
    items
      .filter((item) => !legacySeoRegistrationExclusion(item).excluded)
      .filter((item) => syncedFromCurrentShopling(item))
      .filter((item) => record(optionSyncByModel.get(modelKey(item.modelNumber))).failed !== true)
      .map((item) => modelKey(item.modelNumber))
      .filter(Boolean),
  );
  const canonicalModels = optionSyncError
    ? []
    : duplicateSafeModels.filter((modelNumber) => priceEligibleModels.has(modelNumber));

  let canonicalPriceError = "";
  let canonicalPrice: Awaited<ReturnType<typeof applyLegacySeoCanonicalPrices>> | null = null;
  if (canonicalModels.length) {
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
    const syncResult = record(optionSyncByModel.get(modelNumber));
    const syncFailed = syncResult.failed === true;
    const shoplingConfirmed = syncedFromCurrentShopling(item);
    const issues: LegacySeoPreflightIssue[] = [];
    const add = (field: string, message: string) =>
      issues.push({ itemId, modelNumber, field, message });

    if (exclusion.excluded) {
      add("policy", exclusion.reason || "이전상품 SEO 등록 제외 정책");
    }
    if (optionSyncError) {
      add("shoplingOptions", `Shopling 옵션 동기화 실패: ${optionSyncError}`);
    } else if (syncFailed) {
      add(
        "shoplingOptions",
        `Shopling 옵션 동기화 개별 실패: ${text(syncResult.reason) || "원인 미확인"}`,
      );
    }
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
      } else if (optionSyncError || syncFailed || !shoplingConfirmed) {
        add("canonicalPrice", "현재 Shopling 옵션/B코드 확정 전이라 중국주문 최종가격 적용을 차단했습니다.");
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
    priceEligibleModels: [...priceEligibleModels],
    assetRecovery,
    assetRecoveryError,
    canonicalPrice,
    canonicalPriceError,
    items,
    results,
  };
}
