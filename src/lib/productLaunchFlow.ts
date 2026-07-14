import { inferProductGroupFromPtnGoodsCd, type ProductGroupInference } from "./productGroup";
import type { KeywordPayloadPreviewItem, KeywordPayloadPreviewResult } from "./keywordReviewPayloadPreview";
import { getMarketsForProductGroup } from "./productGroupMarketRegistry";

export type ProductLaunchUploadRow = {
  row?: string | number;
  source_row?: string | number;
  sheet_row?: string | number;
  input_row?: string | number;
  row_number?: string | number;
  sourceRow?: string | number;
  sheetRow?: string | number;
  original_row?: string | number;
  originalRow?: string | number;
  channel?: string;
  code?: string;
  success?: boolean | string;
  ok?: boolean | string;
  goods_key?: string;
  ptn_goods_cd?: string;
  status?: string;
  message?: string;
  msg?: string;
  title?: string;
  product_name?: string;
  productTitle?: string;
  upload_title?: string;
  registered_title?: string;
  final_title?: string;
};

export type ProductLaunchPriceSummary = {
  request_id?: string;
  goods_key_count?: unknown;
  estimated_mall_update_count?: unknown;
  status?: unknown;
  exit_code?: unknown;
  ok_count?: unknown;
  fail_count?: unknown;
  errors?: ProductLaunchPriceError[];
  policy_override_count?: unknown;
};

export type ProductLaunchPriceError = {
  idx?: string | number;
  mall?: string;
  goods_key?: string;
  code?: string | number;
  msg?: string;
};

export { inferProductGroupFromPtnGoodsCd };

export type ProductLaunchGoodsKeyGroupMetadata = {
  goods_key: string;
  ptn_goods_cd: string;
  group_suffix: string;
  product_group: string;
  product_group_type: ProductGroupInference["productGroupType"];
  product_group_status: ProductGroupInference["productGroupStatus"];
};

export function buildGoodsKeyGroupMap(rows: ProductLaunchUploadRow[]) {
  return Object.fromEntries(
    rows
      .map((row) => {
        const goodsKey = (row.goods_key ?? "").trim();
        if (!goodsKey) return null;
        const ptnGoodsCd = (row.ptn_goods_cd ?? "").trim();
        const productGroup = inferProductGroupFromPtnGoodsCd(ptnGoodsCd);
        return [
          goodsKey,
          {
            goods_key: goodsKey,
            ptn_goods_cd: ptnGoodsCd,
            group_suffix: productGroup.groupSuffix,
            product_group: productGroup.productGroup,
            product_group_type: productGroup.productGroupType,
            product_group_status: productGroup.productGroupStatus,
          },
        ];
      })
      .filter((entry): entry is [string, ProductLaunchGoodsKeyGroupMetadata] => entry !== null),
  );
}

export function extractUploadRows(uploadResult: unknown): ProductLaunchUploadRow[] {
  const candidates = collectCandidateArrays(uploadResult);
  const rows = candidates.flatMap((candidate) => candidate.filter(isUploadRowLike));
  return rows.map((row) => ({
    row: stringify(row.row),
    source_row: stringify(row.source_row),
    sheet_row: stringify(row.sheet_row),
    input_row: stringify(row.input_row),
    row_number: stringify(row.row_number),
    sourceRow: stringify(row.sourceRow),
    sheetRow: stringify(row.sheetRow),
    original_row: stringify(row.original_row),
    originalRow: stringify(row.originalRow),
    channel: stringify(row.channel),
    code: stringify(row.code),
    success: booleanOrString(row.success),
    ok: booleanOrString(row.ok),
    goods_key: stringify(row.goods_key),
    ptn_goods_cd: stringify(row.ptn_goods_cd),
    status: stringify(row.status),
    message: stringify(row.message),
    msg: stringify(row.msg),
    title: stringify(row.title),
    product_name: stringify(row.product_name),
    productTitle: stringify(row.productTitle),
    upload_title: stringify(row.upload_title),
    registered_title: stringify(row.registered_title),
    final_title: stringify(row.final_title),
  }));
}

export function extractRowsWithGoodsKey(uploadResult: unknown): ProductLaunchUploadRow[] {
  return extractUploadRows(uploadResult).filter((row) => (row.goods_key ?? "").trim().length > 0);
}

export function dedupeGoodsKeysForPriceModify(rows: ProductLaunchUploadRow[]): string[] {
  const seen = new Set<string>();
  const goodsKeys: string[] = [];
  for (const row of rows) {
    const goodsKey = (row.goods_key ?? "").trim();
    if (!goodsKey || seen.has(goodsKey)) continue;
    seen.add(goodsKey);
    goodsKeys.push(goodsKey);
  }
  return goodsKeys;
}

function collectCandidateArrays(value: unknown): Array<Record<string, unknown>[]> {
  if (!value || typeof value !== "object") return [];
  const objectValue = value as Record<string, unknown>;
  const primaryRows = objectValue.rows;
  const arrays: Array<Record<string, unknown>[]> = [];
  if (Array.isArray(primaryRows) && primaryRows.length > 0) {
    arrays.push(primaryRows);
  } else {
    const knownKeys = ["goods_keys", "goodsKeys", "results", "items"];
    arrays.push(...knownKeys
      .map((key) => objectValue[key])
      .filter((entry): entry is Record<string, unknown>[] => Array.isArray(entry)));
  }

  if (objectValue.summary && typeof objectValue.summary === "object") {
    arrays.push(...collectCandidateArrays(objectValue.summary));
  }
  return arrays;
}

function isUploadRowLike(value: Record<string, unknown>): boolean {
  return "goods_key" in value || "ptn_goods_cd" in value || "channel" in value || "code" in value;
}

function stringify(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value);
}

function booleanOrString(value: unknown): boolean | string | undefined {
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (value === null || value === undefined) return undefined;
  return String(value);
}


export type LaunchSourceRowGroup = {
  sourceRowId: string;
  displayLabel: string;
  goodsKeys: string[];
  productGroups: string[];
  currentTitle: string;
  representativeUploadRow?: ProductLaunchUploadRow;
  mappingMissing: boolean;
};

export const MISSING_SOURCE_ROW_WARNING = "업로드 결과에 원본 행 번호가 없어 행별 키워드를 정확히 연결할 수 없습니다.";

export function parseLaunchRowExpression(rowExpression: string): string[] {
  const rows: string[] = [];
  for (const part of String(rowExpression ?? "").split(/[\s,]+/).map((value) => value.trim()).filter(Boolean)) {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      const step = start <= end ? 1 : -1;
      for (let row = start; step > 0 ? row <= end : row >= end; row += step) rows.push(String(row));
      continue;
    }
    if (/^\d+$/.test(part)) rows.push(part);
  }
  return [...new Set(rows)];
}

export function getLaunchSourceRowId(uploadRow: ProductLaunchUploadRow, fallbackRowExpression = ""): string {
  const sourceRow = readRawString(uploadRow, ["source_row", "sheet_row", "input_row", "row", "row_number", "sourceRow", "sheetRow", "original_row", "originalRow"]).trim();
  if (sourceRow) return sourceRow;
  const parsedRows = parseLaunchRowExpression(fallbackRowExpression);
  return parsedRows.length === 1 ? parsedRows[0] : "";
}

export function buildLaunchSourceRowGroups(uploadRows: ProductLaunchUploadRow[], rowExpression = ""): LaunchSourceRowGroup[] {
  const parsedRows = parseLaunchRowExpression(rowExpression);
  const singleFallbackRow = parsedRows.length === 1 ? parsedRows[0] : "";
  const groups = new Map<string, LaunchSourceRowGroup>();
  for (const uploadRow of uploadRows) {
    const detectedSourceRowId = getLaunchSourceRowId(uploadRow, rowExpression);
    const goodsKey = (uploadRow.goods_key ?? "").trim();
    const sourceRowId = detectedSourceRowId || (goodsKey ? `missing:${goodsKey}` : `missing:${groups.size + 1}`);
    const productGroup = inferProductGroupFromPtnGoodsCd(uploadRow.ptn_goods_cd ?? "").productGroup;
    const currentTitle = String([uploadRow.final_title, uploadRow.registered_title, uploadRow.upload_title, uploadRow.product_name, uploadRow.title, uploadRow.productTitle].find((value) => String(value ?? "").trim()) ?? "키워드 엔진 대기").trim();
    const existing = groups.get(sourceRowId) ?? {
      sourceRowId,
      displayLabel: detectedSourceRowId || singleFallbackRow || "확인 필요",
      goodsKeys: [],
      productGroups: [],
      currentTitle,
      representativeUploadRow: uploadRow,
      mappingMissing: !detectedSourceRowId,
    };
    if (goodsKey && !existing.goodsKeys.includes(goodsKey)) existing.goodsKeys.push(goodsKey);
    if (productGroup && !existing.productGroups.includes(productGroup)) existing.productGroups.push(productGroup);
    if ((!existing.currentTitle || existing.currentTitle === "키워드 엔진 대기") && currentTitle) existing.currentTitle = currentTitle;
    existing.mappingMissing = existing.mappingMissing || !detectedSourceRowId;
    groups.set(sourceRowId, existing);
  }
  return [...groups.values()];
}

export function expandSeedKeywordsBySourceRowToGoodsKeys(seedKeywordsBySourceRow: Record<string, string> = {}, sourceRowGroups: LaunchSourceRowGroup[] = []) {
  const expanded: Record<string, string> = {};
  for (const group of sourceRowGroups) {
    const normalized = normalizeSeedKeywords(seedKeywordsBySourceRow[group.sourceRowId] ?? seedKeywordsBySourceRow[group.displayLabel] ?? "");
    if (!normalized) continue;
    for (const goodsKey of group.goodsKeys) expanded[goodsKey] = normalized;
  }
  return expanded;
}

export function normalizeSeedKeywords(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const seen = new Set<string>();
  return raw
    .split(/[\s,;\/|\n]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => {
      const key = token.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10)
    .join(",");
}

export function normalizeSeedKeywordsByGoodsKey(values: Record<string, string> = {}) {
  return Object.fromEntries(
    Object.entries(values)
      .map(([goodsKey, value]) => [goodsKey.trim(), normalizeSeedKeywords(value)] as const)
      .filter(([goodsKey, value]) => goodsKey && value),
  );
}

export function buildKeywordEngineDispatchPayload(rows: ProductLaunchUploadRow[], seedKeyword?: string, seedKeywordsByGoodsKey: Record<string, string> = {}) {
  const goodsKeyCsv = dedupeGoodsKeysForPriceModify(rows).join(",");
  const trimmedSeedKeyword = seedKeyword?.trim() ?? "";
  const normalizedSeedKeywordsByGoodsKey = normalizeSeedKeywordsByGoodsKey(seedKeywordsByGoodsKey);
  return {
    kind: "keyword_engine",
    mode: "dry_run",
    inputs: {
      goods_key: goodsKeyCsv,
      ...(trimmedSeedKeyword ? { seed_keyword: trimmedSeedKeyword } : {}),
      ...(Object.keys(normalizedSeedKeywordsByGoodsKey).length > 0 ? { seed_keywords_by_goods_key_json: JSON.stringify(normalizedSeedKeywordsByGoodsKey) } : {}),
    },
  };
}

export type LaunchCoverageRowLike = {
  goodsKey?: string;
  recommendedTitle?: string;
  originalTitle?: string;
  editedTitle?: string;
  reviewStatus?: string;
  classification?: string;
  blockReason?: string;
  productGroup?: string;
  ptnGoodsCd?: string;
};

export type LaunchTitleBlockReason = "no_candidate" | "numeric_only" | "product_gather_failed" | "missing_product_group";

export const LAUNCH_TITLE_BLOCK_REASON_LABELS: Record<LaunchTitleBlockReason, string> = {
  no_candidate: "상품명 후보가 없습니다.",
  numeric_only: "상품명이 상품번호로만 되어 있어 자동 반영하지 않았습니다.",
  product_gather_failed: "상품정보 조회가 늦어 후보가 부족합니다. 현재 상품명을 다시 확인하거나 잠시 후 재실행하세요.",
  missing_product_group: "상품그룹을 확인할 수 없습니다.",
};

export const BLANK_MALL_TITLE_BLOCK_MESSAGE = "쇼핑몰별 상품명이 비어 있어 실제 반영을 중단했습니다.";
export const PARTIAL_MALL_TITLE_BLOCK_MESSAGE = "상품명 반영 대상 중 일부가 비어 있습니다. 누락 상품명을 자동 보강하세요.";

export function readRawString(row: { raw?: Record<string, string> } | Record<string, unknown> | undefined, keys: string[]): string {
  if (!row || typeof row !== "object") return "";
  const direct = row as Record<string, unknown>;
  for (const key of keys) {
    const value = direct[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value);
  }
  const raw = "raw" in direct && direct.raw && typeof direct.raw === "object" ? direct.raw as Record<string, unknown> : {};
  for (const key of keys) {
    const value = raw[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value);
  }
  return "";
}

export function isSafeMallTitle(title: unknown): title is string {
  const value = String(title ?? "").replace(/\s+/g, " ").trim();
  if (!value || value === "-") return false;
  return !/^\d+$/.test(value);
}

export function isSafeLaunchTitle(title: unknown): title is string {
  return isSafeMallTitle(title);
}

export function resolveManualTitleOverride(value: unknown, goodsKey?: string): string {
  const title = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!isSafeMallTitle(title)) return "";
  if (goodsKey && title === String(goodsKey).trim()) return "";
  return title;
}

export function normalizeManualKeywordOverride(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const tokens = raw
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => /[가-힣]/.test(token));
  const source = tokens.length > 0 ? tokens : raw.split(/[\s,]+/).map((token) => token.trim()).filter(Boolean);
  const seen = new Set<string>();
  return source.filter((token) => {
    const key = token.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10).join(",");
}

const DANGEROUS_MANUAL_TERMS = new Set(["무료배송", "최저가", "1위", "특허", "인증완료"]);

export function parseManualCandidateList(value: string, maxCandidates = 20): string[] {
  const seen = new Set<string>();
  return String(value ?? "")
    .split(/[,\n;\/|]+/)
    .map((token) => token.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((token) => !DANGEROUS_MANUAL_TERMS.has(token))
    .filter((token) => {
      const key = token.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxCandidates);
}

export function normalizeSearchKeywords(candidates: string[]): string {
  const seen = new Set<string>();
  return candidates
    .map((token) => token.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((token) => {
      const key = token.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10)
    .join(",");
}

const UNVERIFIED_ATTRIBUTE_MODIFIERS = new Set(["방수", "인증", "KC", "정품", "공식", "새상품"]);

function baseProductTitleTokens(baseProductTitle: string) {
  return parseManualCandidateList(baseProductTitle.replace(/[^\p{L}\p{N}\s,;\/|]+/gu, " "), 20);
}

export function generateMallTitlesFromManualCandidates(input: {
  sourceRow: string;
  goodsKey: string;
  productGroup: string;
  mallKey: string;
  baseProductTitle: string;
  titleCandidates: string[];
  searchCandidates: string[];
}): string {
  const sourceTitle = input.baseProductTitle ?? "";
  const allowedAttributeCandidates = new Set(
    [...input.titleCandidates, ...baseProductTitleTokens(sourceTitle)].filter((token) => !UNVERIFIED_ATTRIBUTE_MODIFIERS.has(token) || sourceTitle.includes(token)),
  );
  const safeTitleCandidates = input.titleCandidates.filter((token) => !UNVERIFIED_ATTRIBUTE_MODIFIERS.has(token) || allowedAttributeCandidates.has(token));
  const baseTokens = baseProductTitleTokens(sourceTitle).filter((token) => !UNVERIFIED_ATTRIBUTE_MODIFIERS.has(token) || allowedAttributeCandidates.has(token));
  const pool = [...safeTitleCandidates, ...baseTokens].filter(Boolean);
  const deduped = [...new Map(pool.map((token) => [token.toLocaleLowerCase(), token])).values()].slice(0, 6);
  if (deduped.length === 0) return "";
  const rotationSeed = Math.abs([...`${input.sourceRow}:${input.goodsKey}:${input.productGroup}:${input.mallKey}`].reduce((sum, char) => sum + char.charCodeAt(0), 0));
  const offset = deduped.length > 1 ? rotationSeed % deduped.length : 0;
  const rotated = [...deduped.slice(offset), ...deduped.slice(0, offset)];
  return rotated.slice(0, Math.min(5, rotated.length)).join(" ").replace(/,/g, "").replace(/\s+/g, " ").trim();
}

export function buildManualCandidatePreview(input: {
  sourceRowGroups: LaunchSourceRowGroup[];
  uploadRows: ProductLaunchUploadRow[];
  manualTitleCandidatesBySourceRow: Record<string, string>;
  manualSearchCandidatesBySourceRow: Record<string, string>;
}): KeywordPayloadPreviewResult {
  const uploadRowsByGoodsKey = new Map(input.uploadRows.map((row) => [(row.goods_key ?? "").trim(), row]));
  const items: KeywordPayloadPreviewItem[] = input.sourceRowGroups.flatMap((group) => {
    const titleCandidates = parseManualCandidateList(input.manualTitleCandidatesBySourceRow[group.sourceRowId] ?? "");
    const searchCandidates = parseManualCandidateList(input.manualSearchCandidatesBySourceRow[group.sourceRowId] ?? "");
    return group.goodsKeys.flatMap((goodsKey) => {
      const uploadRow = uploadRowsByGoodsKey.get(goodsKey);
      const productGroup = inferProductGroupFromPtnGoodsCd(uploadRow?.ptn_goods_cd ?? "").productGroup;
      const markets = getMarketsForProductGroup(productGroup);
      const fallbackSearch = searchCandidates.length > 0 ? searchCandidates : titleCandidates.length > 0 ? titleCandidates : baseProductTitleTokens(group.currentTitle);
      const finalSiteSrch = normalizeSearchKeywords(fallbackSearch);
      return markets.map((market, index) => {
        const finalTitle = generateMallTitlesFromManualCandidates({
          sourceRow: group.sourceRowId,
          goodsKey,
          productGroup,
          mallKey: market.mallKey,
          baseProductTitle: group.currentTitle,
          titleCandidates,
          searchCandidates,
        });
        const validation_errors = [!finalTitle ? "상품명 후보가 없습니다." : "", !finalSiteSrch ? "검색어 부족" : ""].filter(Boolean);
        return {
          goods_key: goodsKey,
          mall_key: market.mallKey,
          source_row_index: Number(group.displayLabel) || index,
          ptn_goods_cd: uploadRow?.ptn_goods_cd ?? "",
          group_suffix: inferProductGroupFromPtnGoodsCd(uploadRow?.ptn_goods_cd ?? "").groupSuffix,
          product_group: productGroup,
          product_group_type: String(inferProductGroupFromPtnGoodsCd(uploadRow?.ptn_goods_cd ?? "").productGroupType),
          product_group_status: String(inferProductGroupFromPtnGoodsCd(uploadRow?.ptn_goods_cd ?? "").productGroupStatus),
          original_title: group.currentTitle,
          recommended_title: finalTitle,
          edited_title: "",
          final_title: finalTitle,
          original_site_srch: "",
          recommended_site_srch: finalSiteSrch,
          edited_site_srch: "",
          edited_mall_key: market.mallKey,
          final_site_srch: finalSiteSrch,
          classification: validation_errors.length ? "manual_review" as const : "auto_apply_candidate" as const,
          review_status: validation_errors.length ? "hold" as const : "approved" as const,
          block_reason: validation_errors.join(", "),
          warning_flags: finalSiteSrch.split(",").filter(Boolean).length < 10 ? "검색어 부족" : "",
          payload_status: validation_errors.length ? "invalid" as const : "preview_ready" as const,
          validation_errors,
          validation_warnings: finalSiteSrch.split(",").filter(Boolean).length < 10 && finalSiteSrch ? ["검색어 부족"] : [],
          preview_xml_fragment: null,
          preview_payload: validation_errors.length ? null : { goods_key: goodsKey, mall_key: market.mallKey, title: finalTitle, site_srch: finalSiteSrch },
          expansion_mode: "product_group_markets" as const,
          group_variant_enabled: true,
          market_name: market.marketName,
          account_id_label: market.accountIdLabel,
          group_title: finalTitle,
          mall_title: finalTitle,
          selected_modifier: "",
          word_order_strategy: "manual_candidate_rotation",
        };
      });
    });
  });
  return {
    items,
    previewableItems: items.filter((item) => item.payload_status === "preview_ready"),
    excludedItems: items.filter((item) => item.payload_status !== "preview_ready"),
    summary: {
      totalReviewedRows: items.length,
      approvedCount: items.filter((item) => item.review_status === "approved").length,
      previewReadyCount: items.filter((item) => item.payload_status === "preview_ready").length,
      invalidCount: items.filter((item) => item.payload_status === "invalid").length,
      heldCount: items.filter((item) => item.payload_status === "held").length,
      blockedRiskCount: 0,
    },
    previewXml: "",
    expansionMode: "product_group_markets" as const,
    expandedItemCount: items.length,
    groupVariantEnabled: true,
    attributeModifierMode: "safe_source_only" as const,
    expansionErrors: [],
  };
}

export function resolveManualKeywordOverride(value: unknown): string {
  return normalizeManualKeywordOverride(value);
}

export function resolveMallTitle(row: LaunchCoverageRowLike, uploadRow?: ProductLaunchUploadRow, manualTitleOverridesByGoodsKey: Record<string, string> = {}): string {
  const goodsKey = String(row.goodsKey ?? uploadRow?.goods_key ?? "").trim();
  const manualTitle = resolveManualTitleOverride(manualTitleOverridesByGoodsKey[goodsKey], goodsKey);
  const candidates = [
    manualTitle,
    row.editedTitle,
    row.recommendedTitle,
    readRawString(row, ["mall_title", "final_title", "new_title", "recommended_title", "suggested_title"]),
    row.originalTitle,
    readRawString(row, ["current_title", "old_title", "original_title", "title"]),
    readRawString(uploadRow, ["upload_title", "product_name", "registered_title", "final_title", "title", "productTitle", "original_title"]),
  ];
  return String(candidates.find(isSafeMallTitle) ?? "").replace(/\s+/g, " ").trim();
}

export function getLaunchGoodsKeys(goodsKeys: string[] = [], uploadRows: ProductLaunchUploadRow[] = []) {
  return dedupeGoodsKeysForPriceModify([
    ...goodsKeys.map((goods_key) => ({ goods_key })),
    ...uploadRows,
  ]);
}

export function computeLaunchTitleCoverage(input: {
  goodsKeys?: string[];
  uploadRows?: ProductLaunchUploadRow[];
  rows: LaunchCoverageRowLike[];
  manualTitleOverridesByGoodsKey?: Record<string, string>;
  seedKeywordsByGoodsKey?: Record<string, string>;
}) {
  const launchGoodsKeys = getLaunchGoodsKeys(input.goodsKeys ?? [], input.uploadRows ?? []);
  const uploadRowsByGoodsKey = new Map((input.uploadRows ?? []).map((row) => [(row.goods_key ?? "").trim(), row]));
  const manualReadyGoodsKeys = launchGoodsKeys.filter((goodsKey) => resolveManualTitleOverride(input.manualTitleOverridesByGoodsKey?.[goodsKey], goodsKey));
  const seedReadyGoodsKeys = launchGoodsKeys.filter((goodsKey) => normalizeSeedKeywords(input.seedKeywordsByGoodsKey?.[goodsKey]));
  const approvedRows = input.rows.filter((row) => (row.reviewStatus === "approved" || manualReadyGoodsKeys.includes(String(row.goodsKey ?? "").trim())) && launchGoodsKeys.includes(String(row.goodsKey ?? "").trim()));
  const approvedGoodsKeys = new Set([...approvedRows.map((row) => String(row.goodsKey ?? "").trim()), ...manualReadyGoodsKeys, ...seedReadyGoodsKeys]);
  const readyGoodsKeys = new Set([...manualReadyGoodsKeys, ...seedReadyGoodsKeys, ...approvedRows.filter((row) => resolveMallTitle(row, uploadRowsByGoodsKey.get(String(row.goodsKey ?? "").trim()), input.manualTitleOverridesByGoodsKey)).map((row) => String(row.goodsKey ?? "").trim())]);
  const missingGoodsKeys = launchGoodsKeys.filter((goodsKey) => !readyGoodsKeys.has(goodsKey));
  const blockedGoodsKeys = missingGoodsKeys.map((goodsKey) => {
    const candidates = input.rows.filter((row) => String(row.goodsKey ?? "").trim() === goodsKey);
    const uploadRow = uploadRowsByGoodsKey.get(goodsKey);
    const hasCandidate = candidates.length > 0;
    const hasAnySafeTitle = Boolean(resolveManualTitleOverride(input.manualTitleOverridesByGoodsKey?.[goodsKey], goodsKey)) || Boolean(normalizeSeedKeywords(input.seedKeywordsByGoodsKey?.[goodsKey])) || candidates.some((row) => Boolean(resolveMallTitle(row, uploadRow, input.manualTitleOverridesByGoodsKey))) || isSafeMallTitle(readRawString(uploadRow, ["upload_title", "product_name", "registered_title", "final_title", "title", "productTitle", "original_title"]));
    const hasNumericOnly = candidates.some((row) => [row.editedTitle, row.recommendedTitle, row.originalTitle, readRawString(row, ["mall_title", "final_title", "title"])].some((title) => /^\d+$/.test(String(title ?? "").trim())));
    const missingGroup = candidates.some((row) => String(row.productGroup ?? "").includes("확인 필요"));
    const gatherFailed = candidates.some((row) => /gather|조회|product/i.test(`${row.blockReason ?? ""} ${row.classification ?? ""}`));
    const reason: LaunchTitleBlockReason = missingGroup ? "missing_product_group" : gatherFailed ? "product_gather_failed" : hasNumericOnly && !hasAnySafeTitle ? "numeric_only" : hasCandidate ? "numeric_only" : "no_candidate";
    return { goodsKey, reason, label: LAUNCH_TITLE_BLOCK_REASON_LABELS[reason] };
  });
  const titleReadyCount = readyGoodsKeys.size;
  const titleBlankCount = launchGoodsKeys.length - titleReadyCount;
  const titleBlockedCount = blockedGoodsKeys.length;
  return { launchGoodsKeys, approvedGoodsKeys: [...approvedGoodsKeys], missingGoodsKeys, blockedGoodsKeys, titleReadyCount, titleBlankCount, titleBlockedCount, covered: missingGoodsKeys.length === 0 };
}

export function buildGoodsKeyProductGroupMap(rows: ProductLaunchUploadRow[]) {
  return Object.fromEntries(
    Object.entries(buildGoodsKeyGroupMap(rows))
      .filter(([, metadata]) => metadata.product_group_status === "registered")
      .map(([goodsKey, metadata]) => [goodsKey, metadata.product_group]),
  );
}

export function buildGoodsKeyGroupJson(rows: ProductLaunchUploadRow[]) {
  return JSON.stringify(buildGoodsKeyProductGroupMap(rows));
}

export const FULL_PRICE_POLICY_MALL_COUNT = 24;

export function expectedPriceModifyUpdateCount(goodsKeyProductGroupMap: Record<string, string>) {
  return Object.keys(goodsKeyProductGroupMap).length * FULL_PRICE_POLICY_MALL_COUNT;
}

export function getProductGroupMallCounts(goodsKeyProductGroupMap: Record<string, string>) {
  const counts: Record<string, number> = {};
  for (const productGroup of Object.values(goodsKeyProductGroupMap)) {
    counts[productGroup] = (counts[productGroup] ?? 0) + getMarketsForLaunchProductGroup(productGroup);
  }
  return counts;
}

export function expectedLaunchApplyCount(goodsKeys: string[], goodsKeyGroupMap: Record<string, ProductLaunchGoodsKeyGroupMetadata | undefined>) {
  return goodsKeys.reduce((sum, goodsKey) => {
    const group = goodsKeyGroupMap[goodsKey]?.product_group ?? "";
    return sum + getMarketsForLaunchProductGroup(group);
  }, 0);
}

export function getMarketsForLaunchProductGroup(productGroup: string) {
  const counts: Record<string, number> = { "도매1": 10, "도매2": 4, "도매3": 4, "도매4": 1, "소매1": 12, "소매2": 5 };
  return counts[productGroup.trim()] ?? 0;
}
