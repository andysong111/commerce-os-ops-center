type RawRow = Record<string, unknown>;

const B_CODE = /^B[A-Z]{2}\d+-\d+$/;
const GOODS_KEY = /^\d+$/;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

export function normalizeShoplingBcode(value: unknown) {
  return text(value)
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "");
}

export type ShoplingBcodeIndexRow = {
  account_fingerprint: string;
  barcode: string;
  goods_key: string;
  option_id: string;
  partner_goods_code: string;
  product_sale_status_observed: string;
  option_status_observed: string;
  option_quantity_observed: string;
  source: string;
  refresh_id: string;
  last_seen_at: string;
  updated_at: string;
};

export function buildShoplingBcodeIndexRows(
  rows: RawRow[],
  accountFingerprint: string,
  input: { refreshId: string; observedAt: string },
) {
  const mapped = new Map<string, ShoplingBcodeIndexRow>();
  for (const row of rows) {
    const barcode = normalizeShoplingBcode(row.optPtnOptCd);
    const goodsKey = text(row.goods_key);
    if (!B_CODE.test(barcode) || !GOODS_KEY.test(goodsKey)) continue;
    const optionId = text(row.optId);
    const record: ShoplingBcodeIndexRow = {
      account_fingerprint: accountFingerprint,
      barcode,
      goods_key: goodsKey,
      option_id: optionId,
      partner_goods_code: text(row.ptn_goods_cd),
      product_sale_status_observed: text(row.sale_status).toUpperCase(),
      option_status_observed: text(row.optStatus).toUpperCase(),
      option_quantity_observed: text(row.optQty),
      source: "SHOPLING_PRODUCTS_API_FULL_SCAN",
      refresh_id: input.refreshId,
      last_seen_at: input.observedAt,
      updated_at: input.observedAt,
    };
    mapped.set(
      `${record.account_fingerprint}\u0000${barcode}\u0000${goodsKey}\u0000${optionId}`,
      record,
    );
  }
  return [...mapped.values()].sort(
    (left, right) =>
      left.barcode.localeCompare(right.barcode) ||
      Number(left.goods_key) - Number(right.goods_key) ||
      left.option_id.localeCompare(right.option_id),
  );
}
