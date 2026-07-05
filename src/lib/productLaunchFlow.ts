import { inferProductGroupFromPtnGoodsCd, type ProductGroupInference } from "./productGroup";

export type ProductLaunchUploadRow = {
  row?: string | number;
  channel?: string;
  code?: string;
  success?: boolean | string;
  ok?: boolean | string;
  goods_key?: string;
  ptn_goods_cd?: string;
  status?: string;
  message?: string;
  msg?: string;
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
    channel: stringify(row.channel),
    code: stringify(row.code),
    success: booleanOrString(row.success),
    ok: booleanOrString(row.ok),
    goods_key: stringify(row.goods_key),
    ptn_goods_cd: stringify(row.ptn_goods_cd),
    status: stringify(row.status),
    message: stringify(row.message),
    msg: stringify(row.msg),
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


export function buildKeywordEngineDispatchPayload(rows: ProductLaunchUploadRow[], seedKeyword?: string) {
  const goodsKeyCsv = dedupeGoodsKeysForPriceModify(rows).join(",");
  const trimmedSeedKeyword = seedKeyword?.trim() ?? "";
  return {
    kind: "keyword_engine",
    mode: "dry_run",
    inputs: {
      goods_key: goodsKeyCsv,
      ...(trimmedSeedKeyword ? { seed_keyword: trimmedSeedKeyword } : {}),
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

export function isSafeLaunchTitle(title: unknown): title is string {
  const value = String(title ?? "").replace(/\s+/g, " ").trim();
  if (!value || value === "-") return false;
  return !/^\d+$/.test(value);
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
}) {
  const launchGoodsKeys = getLaunchGoodsKeys(input.goodsKeys ?? [], input.uploadRows ?? []);
  const approvedGoodsKeys = new Set(input.rows.filter((row) => row.reviewStatus === "approved" && launchGoodsKeys.includes(String(row.goodsKey ?? "").trim())).map((row) => String(row.goodsKey ?? "").trim()));
  const missingGoodsKeys = launchGoodsKeys.filter((goodsKey) => !approvedGoodsKeys.has(goodsKey));
  const blockedGoodsKeys = missingGoodsKeys.map((goodsKey) => {
    const candidates = input.rows.filter((row) => String(row.goodsKey ?? "").trim() === goodsKey);
    const hasCandidate = candidates.length > 0;
    const hasAnySafeTitle = candidates.some((row) => [row.editedTitle, row.recommendedTitle, row.originalTitle].some(isSafeLaunchTitle));
    const hasNumericOnly = candidates.some((row) => [row.editedTitle, row.recommendedTitle, row.originalTitle].some((title) => /^\d+$/.test(String(title ?? "").trim())));
    const missingGroup = candidates.some((row) => String(row.productGroup ?? "").includes("확인 필요"));
    const gatherFailed = candidates.some((row) => /gather|조회|product/i.test(`${row.blockReason ?? ""} ${row.classification ?? ""}`));
    const reason: LaunchTitleBlockReason = missingGroup ? "missing_product_group" : gatherFailed ? "product_gather_failed" : hasNumericOnly && !hasAnySafeTitle ? "numeric_only" : hasCandidate ? "numeric_only" : "no_candidate";
    return { goodsKey, reason, label: LAUNCH_TITLE_BLOCK_REASON_LABELS[reason] };
  });
  return { launchGoodsKeys, approvedGoodsKeys: [...approvedGoodsKeys], missingGoodsKeys, blockedGoodsKeys, covered: missingGoodsKeys.length === 0 };
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
