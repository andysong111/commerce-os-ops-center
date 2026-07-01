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
  verified_success_count?: unknown;
  missing_price_count?: unknown;
  missing_mall_row_count?: unknown;
  mismatch_count?: unknown;
  unverified_count?: unknown;
  affected_goods_keys?: unknown;
  affected_malls?: unknown;
  rows?: ProductLaunchPriceVerificationRow[];
};

export type ProductLaunchPriceVerificationStatus = "missing_price" | "missing_mall_row" | "mismatch" | "unverified" | "verified" | string;

export type ProductLaunchPriceVerificationRow = {
  goods_key?: string | number;
  mall_key?: string | number;
  mall_name?: string;
  planned_sale_price?: string | number;
  verified_sale_price?: string | number;
  verification_status?: ProductLaunchPriceVerificationStatus;
  message?: string;
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
