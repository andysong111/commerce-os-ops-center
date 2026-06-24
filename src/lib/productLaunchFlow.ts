export type ProductLaunchUploadRow = {
  row?: string | number;
  channel?: string;
  code?: string;
  success?: boolean | string;
  ok?: boolean | string;
  goods_key?: string;
  ptn_goods_cd?: string;
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

const PRODUCT_GROUP_BY_SUFFIX: Record<string, string> = {
  a: "도매1",
  b: "도매2",
  c: "도매3",
  d: "도매4",
  e: "소매1",
  f: "소매2",
};

export function inferProductGroupFromPtnGoodsCd(ptnGoodsCd: string): string {
  const trimmed = ptnGoodsCd.trim();
  if (!trimmed) return "확인 필요";
  const suffix = trimmed.slice(-1).toLowerCase();
  return PRODUCT_GROUP_BY_SUFFIX[suffix] ?? "확인 필요";
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
  const knownKeys = ["goods_keys", "goodsKeys", "rows", "results", "items"];
  const arrays = knownKeys
    .map((key) => objectValue[key])
    .filter((entry): entry is Record<string, unknown>[] => Array.isArray(entry));

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
