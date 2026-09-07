import {
  loadLegacySeoShoplingEvidence,
  type LegacySeoShoplingEvidence,
  type LegacySeoShoplingOption,
  type LegacySeoShoplingOptionGroup,
} from "@/lib/legacySeoShoplingEvidence";
import {
  syncProductLaunchNormalizedChangedItems,
} from "@/lib/productLaunchTrackerNormalizedStore";
import type { ProductLaunchTrackerState } from "@/lib/productLaunchTrackerOptimized";
import {
  readProductLaunchState,
  writeProductLaunchState,
  type ProductLaunchAdminConfig,
  type ProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";

type UnknownRecord = Record<string, unknown>;

type SyncResult = {
  modelNumber: string;
  changed: boolean;
  sourceGoodsKey: string;
  optionCount: number;
  bCodeCount: number;
  reason: string;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function modelKey(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function valueKey(value: unknown) {
  return text(value)
    .toLowerCase()
    .replace(/[\s,，/|:：()\[\]{}._-]+/g, "");
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => text(value)).filter(Boolean))];
}

function activeGroupOptions(group: LegacySeoShoplingOptionGroup) {
  return group.options.filter((option) => text(option.status).toUpperCase() !== "X");
}

function optionValue(optionName: string) {
  const normalized = text(optionName);
  if (!normalized || normalized === "단품") return "단품";
  return normalized
    .split(/\s*\/\s*/)
    .map((part) => {
      const index = part.search(/[:：]/);
      return index >= 0 ? part.slice(index + 1).trim() : part.trim();
    })
    .filter(Boolean)
    .join(" ") || normalized;
}

function optionTitles(optionName: string) {
  const normalized = text(optionName);
  if (!normalized || normalized === "단품") return [];
  return normalized
    .split(/\s*\/\s*/)
    .map((part) => {
      const index = part.search(/[:：]/);
      return index >= 0 ? part.slice(0, index).trim() : "";
    })
    .filter(Boolean);
}

function groupOptionTitle(options: LegacySeoShoplingOption[]) {
  if (options.every((option) => optionValue(option.optionName) === "단품")) return "단품";
  const titleSets = options.map((option) => optionTitles(option.optionName));
  if (titleSets.length && titleSets.every((titles) => titles.length === 1)) {
    const titles = unique(titleSets.map((titles) => titles[0] ?? ""));
    if (titles.length === 1) return titles[0] ?? "옵션";
  }
  return "옵션";
}

function isGroupedCandidate(group: LegacySeoShoplingOptionGroup) {
  const options = activeGroupOptions(group);
  const bCodes = unique(options.map((option) => option.bCode));
  const meaningful = options.filter((option) => optionValue(option.optionName) !== "단품");
  return options.length > 1 || bCodes.length > 1 || meaningful.length > 1;
}

function goodsKeyNumber(group: LegacySeoShoplingOptionGroup) {
  const value = Number(group.goodsKey);
  return Number.isFinite(value) ? value : 0;
}

function selectGroup(
  evidence: LegacySeoShoplingEvidence,
  currentOptionCount: number,
): LegacySeoShoplingOptionGroup | null {
  const groups = evidence.optionGroups.filter((group) => activeGroupOptions(group).length > 0);
  if (!groups.length) return null;
  const grouped = groups.filter(isGroupedCandidate);
  const pool = grouped.length ? grouped : currentOptionCount <= 1 ? groups : [];
  if (!pool.length) return null;
  return [...pool].sort((left, right) => {
    const leftOptions = activeGroupOptions(left);
    const rightOptions = activeGroupOptions(right);
    const leftB = leftOptions.filter((option) => text(option.bCode)).length;
    const rightB = rightOptions.filter((option) => text(option.bCode)).length;
    const leftCoverage = leftOptions.length ? leftB / leftOptions.length : 0;
    const rightCoverage = rightOptions.length ? rightB / rightOptions.length : 0;
    if (rightCoverage !== leftCoverage) return rightCoverage - leftCoverage;
    if (rightOptions.length !== leftOptions.length) return rightOptions.length - leftOptions.length;
    if (rightB !== leftB) return rightB - leftB;
    return goodsKeyNumber(right) - goodsKeyNumber(left);
  })[0] ?? null;
}

function existingOptions(item: UnknownRecord) {
  return array(item.orderOptions).map(record);
}

function existingRealOptionCount(item: UnknownRecord) {
  return existingOptions(item).filter((option) => text(option.saleOption ?? option.value) !== "단품").length;
}

function mergeOptions(item: UnknownRecord, group: LegacySeoShoplingOptionGroup) {
  const current = existingOptions(item);
  const byBCode = new Map<string, UnknownRecord>();
  const byValue = new Map<string, UnknownRecord>();
  for (const option of current) {
    const bCode = valueKey(option.barcode);
    const saleValue = valueKey(option.saleOption ?? option.value);
    if (bCode && !byBCode.has(bCode)) byBCode.set(bCode, option);
    if (saleValue && !byValue.has(saleValue)) byValue.set(saleValue, option);
  }

  const shoplingOptions = activeGroupOptions(group);
  const optionName = groupOptionTitle(shoplingOptions);
  return shoplingOptions.map((shopling, index) => {
    const saleOption = optionValue(shopling.optionName);
    const bCode = text(shopling.bCode);
    const matched =
      (bCode ? byBCode.get(valueKey(bCode)) : undefined) ??
      byValue.get(valueKey(saleOption)) ??
      {};
    const matchedId = text(matched.id);
    const optionId = matchedId || `shopling-${group.goodsKey}-${text(shopling.optionId) || index + 1}`;
    const optionBarcodeNo = text(matched.optionBarcodeNo) || text(shopling.optionBarcode);
    const identityKey = bCode ? `B:${bCode}` : text(matched.optionBarcodeIdentityKey);
    const identityKind = bCode ? "B_CODE" : text(matched.optionBarcodeIdentityKind);
    return {
      ...matched,
      id: optionId,
      optionName,
      saleOption,
      chinaOption: text(matched.chinaOption),
      barcode: bCode || text(matched.barcode),
      baseSalePriceKrw: Math.max(0, Math.floor(Number(matched.baseSalePriceKrw) || 0)),
      unitCostKrw: Math.max(0, Math.floor(Number(matched.unitCostKrw) || 0)),
      sourceOrderItemId:
        matched.sourceOrderItemId === undefined ? null : matched.sourceOrderItemId,
      optionBarcodeNo,
      optionBarcodeIdentityKey: identityKey,
      optionBarcodeIdentityKind: identityKind,
      shoplingOptionSync: {
        source: "shopling_live_grouped_option_sync",
        goodsKey: group.goodsKey,
        ptnGoodsCd: group.ptnGoodsCd,
        optId: text(shopling.optionId),
        optStatus: text(shopling.status),
        optQty: text(shopling.quantity),
        optAmt: text(shopling.amount),
        syncedAt: new Date().toISOString(),
      },
    };
  });
}

function isActiveLegacyItem(item: UnknownRecord, requestedModels: Set<string>) {
  const model = modelKey(item.modelNumber);
  if (!requestedModels.has(model)) return false;
  if (text(item.workBatch) !== "등록완료건") return false;
  if (text(item.archivedAt)) return false;
  return true;
}

export async function syncLegacySeoShoplingOptions(input: {
  config: ProductLaunchAdminConfig;
  identity: ProductLaunchIdentity;
  modelNumbers: string[];
}) {
  const requested = unique(input.modelNumbers.map(modelKey)).slice(0, 100);
  const requestedModels = new Set(requested);
  if (!requested.length) {
    return { changedCount: 0, results: [] as SyncResult[] };
  }

  const [stateRow, evidenceByModel] = await Promise.all([
    readProductLaunchState(input.config, input.identity.userId),
    loadLegacySeoShoplingEvidence(requested),
  ]);
  const state = record(stateRow?.state_payload);
  const stateItems = array(state.items).map(record);
  if (!stateItems.length) throw new Error("PRODUCT_LAUNCH_STATE_ITEMS_REQUIRED");

  const now = new Date().toISOString();
  const results: SyncResult[] = [];
  const changedIds: string[] = [];
  const nextItems = stateItems.map((item) => {
    if (!isActiveLegacyItem(item, requestedModels)) return item;
    const modelNumber = modelKey(item.modelNumber);
    const evidence = evidenceByModel.get(modelNumber);
    if (!evidence) {
      results.push({
        modelNumber,
        changed: false,
        sourceGoodsKey: "",
        optionCount: 0,
        bCodeCount: 0,
        reason: "Shopling 조회 데이터 없음",
      });
      return item;
    }
    const currentCount = existingRealOptionCount(item);
    const group = selectGroup(evidence, currentCount);
    if (!group) {
      results.push({
        modelNumber,
        changed: false,
        sourceGoodsKey: "",
        optionCount: currentCount,
        bCodeCount: existingOptions(item).filter((option) => text(option.barcode)).length,
        reason:
          currentCount > 1
            ? "묶음형 Shopling 상품을 찾지 못해 기존 옵션 유지"
            : "Shopling 옵션을 찾지 못함",
      });
      return item;
    }

    const merged = mergeOptions(item, group);
    const optionLabels = merged.map((option) => text(option.saleOption)).filter(Boolean);
    const bCodeCount = merged.filter((option) => text(option.barcode)).length;
    const id = text(item.id);
    if (id) changedIds.push(id);
    results.push({
      modelNumber,
      changed: true,
      sourceGoodsKey: group.goodsKey,
      optionCount: merged.length,
      bCodeCount,
      reason: isGroupedCandidate(group) ? "묶음형 Shopling 상품 기준" : "단품 Shopling 기준",
    });
    return {
      ...item,
      optionLabels,
      options: optionLabels,
      orderOptions: merged,
      updatedAt: now,
      updatedBy: "이전상품 Shopling 묶음옵션/B코드 동기화",
      shoplingOptionSync: {
        source: "shopling_live_grouped_option_sync",
        goodsKey: group.goodsKey,
        ptnGoodsCd: group.ptnGoodsCd,
        optionCount: merged.length,
        bCodeCount,
        syncedAt: now,
      },
    };
  });

  if (!changedIds.length) return { changedCount: 0, results };

  const nextState = {
    ...state,
    items: nextItems,
  } as ProductLaunchTrackerState;
  const persisted = await writeProductLaunchState(input.config, input.identity, nextState as UnknownRecord);
  const sourceUpdatedAt = text(record(persisted).updated_at) || now;
  await syncProductLaunchNormalizedChangedItems(
    input.config,
    input.identity,
    nextState,
    sourceUpdatedAt,
    changedIds,
  );

  return {
    changedCount: changedIds.length,
    results,
  };
}
