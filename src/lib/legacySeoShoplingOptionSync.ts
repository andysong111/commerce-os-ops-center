import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  loadLegacySeoShoplingEvidence,
  type LegacySeoGoodsKeyOverrides,
  type LegacySeoShoplingEvidence,
  type LegacySeoShoplingOption,
  type LegacySeoShoplingOptionGroup,
} from "@/lib/legacySeoShoplingEvidence";
import {
  readProductLaunchStorageJson,
  type ProductLaunchAdminConfig,
  type ProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";

type UnknownRecord = Record<string, unknown>;

type SyncResult = {
  itemId: string;
  modelNumber: string;
  changed: boolean;
  failed: boolean;
  status: "synced" | "existing_preserved" | "failed";
  sourceGoodsKey: string;
  optionCount: number;
  bCodeCount: number;
  reason: string;
};

type NormalizedItem = {
  itemId: string;
  modelNumber: string;
  itemPayload: UnknownRecord;
  summaryPayload: UnknownRecord;
  options: UnknownRecord[];
};

const ITEM_TABLE = "product_launch_items";
const OPTION_TABLE = "product_launch_options";
const MAX_TRACKER_GOODS_KEYS_PER_MODEL = 120;

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

function postgrestIn(values: string[]) {
  return values
    .map((value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
    .join(",");
}

function clone(value: unknown): UnknownRecord {
  return { ...record(value) };
}

function activeGroupOptions(group: LegacySeoShoplingOptionGroup) {
  // Legacy SEO re-registration requires a real inventory B-code for every option.
  // Historical/discontinued Shopling option rows whose B-code is already gone
  // must never be recreated as a registration option.
  return group.options.filter(
    (option) =>
      text(option.status).toUpperCase() !== "X" && Boolean(text(option.bCode)),
  );
}

function optionValue(optionName: string) {
  const normalized = text(optionName);
  if (!normalized || normalized === "단품") return "단품";
  return (
    normalized
      .split(/\s*\/\s*/)
      .map((part) => {
        const index = part.search(/[:：]/);
        return index >= 0 ? part.slice(index + 1).trim() : part.trim();
      })
      .filter(Boolean)
      .join(" ") || normalized
  );
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

function selectGroup(evidence: LegacySeoShoplingEvidence, currentOptionCount: number) {
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

function rowToOption(row: UnknownRecord) {
  const payload = clone(row.option_payload);
  const barcode = text(payload.barcode) || text(row.barcode);
  const optionBarcodeNo = text(payload.optionBarcodeNo) || text(row.option_barcode_no);
  const identityKey =
    text(payload.optionBarcodeIdentityKey) ||
    text(row.option_barcode_identity_key) ||
    (barcode ? `B:${barcode}` : "");
  return {
    ...payload,
    id: text(payload.id) || text(row.option_id),
    optionName: text(payload.optionName) || text(row.option_name) || "옵션",
    saleOption: text(payload.saleOption ?? payload.value) || text(row.sale_option),
    chinaOption: text(payload.chinaOption) || text(row.china_option),
    barcode,
    baseSalePriceKrw: Math.max(
      0,
      Math.floor(Number(payload.baseSalePriceKrw ?? row.base_sale_price_krw) || 0),
    ),
    unitCostKrw: Math.max(
      0,
      Math.floor(Number(payload.unitCostKrw ?? row.unit_cost_krw) || 0),
    ),
    sourceOrderItemId:
      payload.sourceOrderItemId ?? row.source_order_item_id ?? null,
    optionBarcodeNo,
    optionBarcodeIdentityKey: identityKey,
    optionBarcodeIdentityKind:
      text(payload.optionBarcodeIdentityKind) ||
      (identityKey.startsWith("B:") ? "B_CODE" : "OPTION"),
  };
}

function existingRealOptionCount(options: UnknownRecord[]) {
  return options.filter((option) => text(option.saleOption ?? option.value) !== "단품").length;
}

function mergeOptions(current: UnknownRecord[], group: LegacySeoShoplingOptionGroup) {
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
    const identityKind = bCode ? "B_CODE" : text(matched.optionBarcodeIdentityKind) || "OPTION";
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

function trackerGoodsKeys(itemPayload: UnknownRecord) {
  const detailSource = record(itemPayload.detailPageAssetSource);
  const detailAsset = record(itemPayload.detailPageAsset);
  const detailAssetSource = record(detailAsset.source);
  const keys = [
    ...array(detailSource.goodsKeys),
    ...array(detailAssetSource.goodsKeys),
    ...Object.values(record(itemPayload.shoplingProducts)).map((value) => record(value).goodsKey),
  ]
    .map(text)
    .filter((value) => /^\d{5,12}$/.test(value));
  return unique(keys).slice(-MAX_TRACKER_GOODS_KEYS_PER_MODEL).reverse();
}

function goodsKeyOverridesFromItems(items: NormalizedItem[]): LegacySeoGoodsKeyOverrides {
  const result = new Map<string, readonly string[]>();
  for (const item of items) {
    const keys = trackerGoodsKeys(item.itemPayload);
    if (keys.length) result.set(item.modelNumber, keys);
  }
  return result;
}

async function loadNormalizedItems(
  config: ProductLaunchAdminConfig,
  ownerId: string,
  modelNumbers: string[],
): Promise<NormalizedItem[]> {
  const models = unique(modelNumbers.map(modelKey));
  if (!models.length) return [];
  const itemParams = new URLSearchParams({
    select:
      "item_id,model_number,item_payload,summary_payload,option_labels,option_barcodes,updated_at,updated_by",
    owner_id: `eq.${ownerId}`,
    shopling_upload_status: "eq.완료",
    archived_at: "is.null",
    model_number: `in.(${postgrestIn(models)})`,
    limit: "500",
  });
  const { body: itemBody } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/${ITEM_TABLE}?${itemParams.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  const itemRows = (Array.isArray(itemBody) ? itemBody : []).map(record);
  const itemIds = itemRows.map((row) => text(row.item_id)).filter(Boolean);
  if (!itemIds.length) return [];
  const optionParams = new URLSearchParams({
    select:
      "item_id,option_id,option_index,option_name,sale_option,china_option,barcode,base_sale_price_krw,unit_cost_krw,source_order_item_id,option_payload,option_barcode_no,option_barcode_identity_key,updated_at",
    owner_id: `eq.${ownerId}`,
    item_id: `in.(${postgrestIn(itemIds)})`,
    order: "item_id.asc,option_index.asc",
    limit: "5000",
  });
  const { body: optionBody } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/${OPTION_TABLE}?${optionParams.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  const optionsByItem = new Map<string, UnknownRecord[]>();
  for (const raw of Array.isArray(optionBody) ? optionBody : []) {
    const row = record(raw);
    const itemId = text(row.item_id);
    if (!itemId) continue;
    const list = optionsByItem.get(itemId) ?? [];
    list.push(rowToOption(row));
    optionsByItem.set(itemId, list);
  }
  return itemRows.map((row) => ({
    itemId: text(row.item_id),
    modelNumber: modelKey(row.model_number),
    itemPayload: clone(row.item_payload),
    summaryPayload: clone(row.summary_payload),
    options: optionsByItem.get(text(row.item_id)) ?? [],
  }));
}

async function patchItem(
  config: ProductLaunchAdminConfig,
  ownerId: string,
  item: NormalizedItem,
  options: UnknownRecord[],
  metadata: UnknownRecord,
  now: string,
) {
  const labels = options.map((option) => text(option.saleOption ?? option.value)).filter(Boolean);
  const barcodes = options.map((option) => text(option.barcode)).filter(Boolean);
  const itemPayload = {
    ...item.itemPayload,
    optionLabels: labels,
    options: labels,
    shoplingOptionSync: metadata,
    updatedAt: now,
    updatedBy: "이전상품 Shopling 묶음옵션/B코드 동기화",
  };
  const summaryPayload = {
    ...item.summaryPayload,
    optionLabels: labels,
  };
  const params = new URLSearchParams({
    owner_id: `eq.${ownerId}`,
    item_id: `eq.${item.itemId}`,
  });
  await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/${ITEM_TABLE}?${params.toString()}`,
    {
      method: "PATCH",
      headers: {
        ...createSupabaseAdminHeaders(config.secretKey),
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        option_labels: labels,
        option_barcodes: barcodes,
        option_sort_text: labels.join(", "),
        item_payload: itemPayload,
        summary_payload: summaryPayload,
        updated_at: now,
        updated_by: "이전상품 Shopling 묶음옵션/B코드 동기화",
      }),
      cache: "no-store",
    },
  );
}

async function replaceOptionsAtomic(
  config: ProductLaunchAdminConfig,
  ownerId: string,
  itemId: string,
  options: UnknownRecord[],
  now: string,
) {
  if (!options.length) {
    throw new Error("LEGACY_SEO_OPTION_REPLACE_EMPTY_ROWS_BLOCKED");
  }
  const rows = options.map((option, index) => ({
    option_id: text(option.id) || `shopling-option-${index + 1}`,
    option_index: index,
    option_name: text(option.optionName) || "옵션",
    sale_option: text(option.saleOption ?? option.value),
    china_option: text(option.chinaOption),
    barcode: text(option.barcode).toUpperCase().replace(/\s+/g, ""),
    base_sale_price_krw: Math.max(0, Math.floor(Number(option.baseSalePriceKrw) || 0)),
    unit_cost_krw: Math.max(0, Math.floor(Number(option.unitCostKrw) || 0)),
    source_order_item_id: option.sourceOrderItemId ?? null,
    option_payload: option,
    option_barcode_no: text(option.optionBarcodeNo),
    option_barcode_identity_key: text(option.optionBarcodeIdentityKey),
    updated_at: now,
  }));
  const { body } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/rpc/replace_product_launch_options_atomic`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(config.secretKey),
        Prefer: "return=representation",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_owner_id: ownerId,
        p_item_id: itemId,
        p_rows: rows,
      }),
      cache: "no-store",
    },
  );
  const result = record(body);
  if (result.ok !== true || Number(result.insertedCount) !== rows.length) {
    throw new Error(
      `LEGACY_SEO_OPTION_REPLACE_COUNT_MISMATCH:${Number(result.insertedCount) || 0}/${rows.length}`,
    );
  }
}

export async function syncLegacySeoShoplingOptions(input: {
  config: ProductLaunchAdminConfig;
  identity: ProductLaunchIdentity;
  modelNumbers: string[];
}) {
  const requested = unique(input.modelNumbers.map(modelKey)).slice(0, 100);
  if (!requested.length) {
    return {
      changedCount: 0,
      processedCount: 0,
      failedCount: 0,
      results: [] as SyncResult[],
    };
  }

  const items = await loadNormalizedItems(
    input.config,
    input.identity.userId,
    requested,
  );
  const evidenceByModel = await loadLegacySeoShoplingEvidence(
    requested,
    goodsKeyOverridesFromItems(items),
  );
  const now = new Date().toISOString();
  const results: SyncResult[] = [];
  let changedCount = 0;

  for (const item of items) {
    const current = item.options;
    try {
      const evidence = evidenceByModel.get(item.modelNumber);
      const currentCount = existingRealOptionCount(current);
      const group = evidence ? selectGroup(evidence, currentCount) : null;

      if (!group) {
        const reason = evidence
          ? currentCount > 1
            ? "묶음형 Shopling 상품을 찾지 못해 기존 옵션 유지"
            : "Shopling 묶음옵션 없음 · 기존 옵션 유지"
          : "Shopling 조회 데이터 없음 · 기존 옵션 유지";
        const metadata = {
          source: "shopling_live_grouped_option_sync",
          status: "existing_preserved",
          reason,
          optionCount: current.length,
          bCodeCount: current.filter((option) => text(option.barcode)).length,
          syncedAt: now,
        };
        await patchItem(input.config, input.identity.userId, item, current, metadata, now);
        results.push({
          itemId: item.itemId,
          modelNumber: item.modelNumber,
          changed: false,
          failed: false,
          status: "existing_preserved",
          sourceGoodsKey: "",
          optionCount: current.length,
          bCodeCount: current.filter((option) => text(option.barcode)).length,
          reason,
        });
        continue;
      }

      const merged = mergeOptions(current, group);
      const bCodeCount = merged.filter((option) => text(option.barcode)).length;
      const metadata = {
        source: "shopling_live_grouped_option_sync",
        status: "synced",
        goodsKey: group.goodsKey,
        ptnGoodsCd: group.ptnGoodsCd,
        optionCount: merged.length,
        bCodeCount,
        syncedAt: now,
      };
      await replaceOptionsAtomic(
        input.config,
        input.identity.userId,
        item.itemId,
        merged,
        now,
      );
      await patchItem(input.config, input.identity.userId, item, merged, metadata, now);
      changedCount += 1;
      results.push({
        itemId: item.itemId,
        modelNumber: item.modelNumber,
        changed: true,
        failed: false,
        status: "synced",
        sourceGoodsKey: group.goodsKey,
        optionCount: merged.length,
        bCodeCount,
        reason: isGroupedCandidate(group) ? "묶음형 Shopling 상품 기준" : "단품 Shopling 기준",
      });
    } catch (error) {
      results.push({
        itemId: item.itemId,
        modelNumber: item.modelNumber,
        changed: false,
        failed: true,
        status: "failed",
        sourceGoodsKey: "",
        optionCount: current.length,
        bCodeCount: current.filter((option) => text(option.barcode)).length,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    changedCount,
    processedCount: items.length,
    failedCount: results.filter((result) => result.failed).length,
    results,
  };
}
