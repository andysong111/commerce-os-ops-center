export type ProductLaunchUploadRow = {
  row: string;
  channel: string;
  code: string;
  success: boolean | string;
  goods_key: string;
  ptn_goods_cd: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function inferProductGroupFromPtnGoodsCd(ptnGoodsCd: string): string {
  const prefix = ptnGoodsCd.trim().charAt(0);
  if (prefix === "1") return "도매1";
  if (prefix === "2") return "도매2";
  if (prefix === "3") return "도매3";
  if (prefix === "4") return "도매4";
  if (prefix === "5") return "소매1";
  if (prefix === "6") return "소매2";
  return "확인 필요";
}

export function extractUploadGoodsKeyRows(summary: unknown): ProductLaunchUploadRow[] {
  const root = asRecord(summary);
  const nestedSummary = asRecord(root?.summary);
  const source = root?.goods_keys ?? nestedSummary?.goods_keys ?? root?.rows ?? nestedSummary?.rows;
  if (!Array.isArray(source)) return [];

  return source
    .map((item) => {
      const row = asRecord(item);
      if (!row) return null;
      const goodsKey = text(row.goods_key ?? row.goodsKey);
      if (!goodsKey) return null;
      return {
        row: text(row.row),
        channel: text(row.channel),
        code: text(row.code),
        success: typeof row.success === "boolean" ? row.success : text(row.success ?? row.ok),
        goods_key: goodsKey,
        ptn_goods_cd: text(row.ptn_goods_cd ?? row.ptnGoodsCd),
      } satisfies ProductLaunchUploadRow;
    })
    .filter((row): row is ProductLaunchUploadRow => row !== null);
}

export function uniqueGoodsKeys(rows: Pick<ProductLaunchUploadRow, "goods_key">[]): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const row of rows) {
    const goodsKey = row.goods_key.trim();
    if (!goodsKey || seen.has(goodsKey)) continue;
    seen.add(goodsKey);
    keys.push(goodsKey);
  }
  return keys;
}
