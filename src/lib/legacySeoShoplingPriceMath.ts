export function parseShoplingKrw(value: unknown) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s,원₩]/g, "")
    .trim();
  if (!normalized) return 0;
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

export function resolveLegacyShoplingOptionSalePrice(
  salePrice: unknown,
  additionalAmount: unknown,
) {
  const base = parseShoplingKrw(salePrice);
  if (base <= 0) return 0;
  const result = base + parseShoplingKrw(additionalAmount);
  return result > 0 ? result : 0;
}
