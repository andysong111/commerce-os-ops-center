import type { ShoplingRawRow } from "@/lib/shopling/shoplingNormalize";

const ORDER_TITLE_KEYS = [
  "t_prod_nm",
  "t_opt_valu",
  "mall_prod_nm",
  "mall_opt_valu",
  "prod_nm",
  "opt_valu",
  "productName",
  "optionName",
] as const;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function rawValue(row: ShoplingRawRow, key: string) {
  const direct = row[key];
  if (direct !== undefined && direct !== null && direct !== "") return text(direct);
  const matchedKey = Object.keys(row).find(
    (candidate) => candidate.toLowerCase() === key.toLowerCase(),
  );
  return matchedKey ? text(row[matchedKey]) : "";
}

function candidateSet(values: Iterable<number>) {
  return new Set(
    [...values]
      .map((value) => Math.round(Number(value)))
      .filter((value) => Number.isInteger(value) && value >= 1),
  );
}

function explicitPackUnits(source: string) {
  const found = new Set<number>();
  for (const match of source.matchAll(/(?:^|\D)(\d{1,2})\s*\+\s*(\d{1,2})(?:\D|$)/g)) {
    found.add(Number(match[1]) + Number(match[2]));
  }
  for (const match of source.matchAll(
    /(?:^|\D)(\d{1,2})\s*(?:개입|입\s*(?:세트|구성|팩)|개\s*(?:세트|묶음|구성|팩)|p(?:cs)?)(?:\D|$)/gi,
  )) {
    found.add(Number(match[1]));
  }
  return found;
}

/**
 * Resolves a direct B-code whose current listings contain more than one pack
 * ratio. Shopling's old option IDs can disappear, but the order-time product
 * and option names remain source evidence. An explicit bundle marker wins;
 * otherwise a non-empty title means the listing was the base single unit.
 * Missing or conflicting evidence stays fail-closed.
 */
export function resolveShoplingDirectPackUnits(
  raw: ShoplingRawRow,
  candidateUnits: Iterable<number>,
): number | null {
  const candidates = candidateSet(candidateUnits);
  if (candidates.size === 0) return null;
  if (candidates.size === 1) return [...candidates][0] ?? null;

  const source = ORDER_TITLE_KEYS.map((key) => rawValue(raw, key))
    .filter(Boolean)
    .join(" | ");
  if (!source) return null;

  const explicit = explicitPackUnits(source);
  if (explicit.size > 1) return null;
  if (explicit.size === 1) {
    const inferred = [...explicit][0] ?? 0;
    return candidates.has(inferred) ? inferred : null;
  }
  return candidates.has(1) ? 1 : null;
}
