import {
  INTERNAL_PRICE_GROUP_LABELS,
  INTERNAL_PRICE_GROUP_MALLS,
  searchPrefixForLabel,
  normalizeInternalPriceGroup,
  type InternalPriceGroup,
} from "@/lib/internalChinaPriceGroupPolicy";
import type { MonthlyObservation, MonthlyPriceCandidate } from "@/lib/monthlyPriceCore";

export type MonthlyPriceGroupRecoverySource =
  | "OPS_REGISTRY"
  | "SELF_CODE_PREFIX"
  | "WHOLESALE_CHANNEL_FAMILY"
  | "RETAIL_CHANNEL_FAMILY"
  | "PRICE_BAND_WHOLESALE"
  | "PRICE_BAND_RETAIL"
  | "UNRESOLVED";

export type MonthlyPriceGroupRecovery = {
  group: InternalPriceGroup | null;
  source: MonthlyPriceGroupRecoverySource;
  mallScopeKeys: string[];
  partnerCode: string;
  priceRatio: number | null;
};

const WHOLESALE_GROUPS: InternalPriceGroup[] = ["도매1", "도매2", "도매3", "도매4"];
const RETAIL_GROUPS: InternalPriceGroup[] = ["소매1", "소매2"];
const mallSet = (groups: InternalPriceGroup[]) =>
  new Set(groups.flatMap((group) => INTERNAL_PRICE_GROUP_MALLS[group].map((row) => row.mallKey)));
const WHOLESALE_MALLS = mallSet(WHOLESALE_GROUPS);
const RETAIL_MALLS = mallSet(RETAIL_GROUPS);

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function exactGroupFromPartnerCodes(rows: Record<string, unknown>[]) {
  const codes = [...new Set(rows.map((row) => text(row.ptn_goods_cd)).filter(Boolean))];
  const groups = new Set<InternalPriceGroup>();
  for (const code of codes) {
    for (const group of INTERNAL_PRICE_GROUP_LABELS) {
      if (code.toUpperCase().startsWith(searchPrefixForLabel(group))) groups.add(group);
    }
  }
  return {
    group: groups.size === 1 ? [...groups][0] : null,
    partnerCode: codes.length === 1 ? codes[0] : "",
  };
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function currentPriceRatio(candidate: MonthlyPriceCandidate, rows: Record<string, unknown>[]) {
  const byBarcode = new Map(candidate.options.map((option) => [option.barcode, option]));
  const ratios: number[] = [];
  for (const row of rows) {
    const option = byBarcode.get(text(row.optPtnOptCd));
    if (!option) continue;
    const salePrice = Number(row.sale_price), amount = Number(row.optAmt ?? 0);
    const costBase = Number(option.protectedCostKrw) * Number(option.unitsPerOrder) * 2;
    if (!Number.isFinite(salePrice) || !Number.isFinite(amount) || !Number.isFinite(costBase) || salePrice <= 0 || amount < 0 || costBase <= 0) continue;
    ratios.push((salePrice + amount) / costBase);
  }
  return median(ratios);
}

export function recoverMonthlyPriceGroup(input: {
  registeredGroup?: unknown;
  candidate: MonthlyPriceCandidate;
  liveRows: Record<string, unknown>[];
  observation: MonthlyObservation;
}): MonthlyPriceGroupRecovery {
  const registered = normalizeInternalPriceGroup(input.registeredGroup);
  if (registered) return { group: registered, source: "OPS_REGISTRY", mallScopeKeys: [], partnerCode: "", priceRatio: null };

  const observed = [...new Set(input.observation.rows.map((row) => row.mallKey))];
  const partner = exactGroupFromPartnerCodes(input.liveRows);
  if (partner.group) {
    const allowed = new Set(INTERNAL_PRICE_GROUP_MALLS[partner.group].map((row) => row.mallKey));
    return { group: partner.group, source: "SELF_CODE_PREFIX", mallScopeKeys: observed.filter((key) => allowed.has(key)), partnerCode: partner.partnerCode, priceRatio: null };
  }

  const wholesale = observed.filter((key) => WHOLESALE_MALLS.has(key));
  const retail = observed.filter((key) => RETAIL_MALLS.has(key));
  if (wholesale.length && !retail.length) {
    return { group: "도매1", source: "WHOLESALE_CHANNEL_FAMILY", mallScopeKeys: wholesale, partnerCode: partner.partnerCode, priceRatio: currentPriceRatio(input.candidate, input.liveRows) };
  }
  if (retail.length && !wholesale.length) {
    return { group: "소매1", source: "RETAIL_CHANNEL_FAMILY", mallScopeKeys: retail, partnerCode: partner.partnerCode, priceRatio: currentPriceRatio(input.candidate, input.liveRows) };
  }

  const ratio = currentPriceRatio(input.candidate, input.liveRows);
  // Price is deliberately only a high-confidence fallback. Wholesale4 and
  // retail1 overlap around 1.30x, so the ambiguous middle band is never guessed.
  if (ratio !== null && ratio <= 1.15) {
    return { group: "도매1", source: "PRICE_BAND_WHOLESALE", mallScopeKeys: wholesale, partnerCode: partner.partnerCode, priceRatio: ratio };
  }
  if (ratio !== null && ratio >= 1.37) {
    return { group: "소매1", source: "PRICE_BAND_RETAIL", mallScopeKeys: retail, partnerCode: partner.partnerCode, priceRatio: ratio };
  }
  return { group: null, source: "UNRESOLVED", mallScopeKeys: [], partnerCode: partner.partnerCode, priceRatio: ratio };
}
