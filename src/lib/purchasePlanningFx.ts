export const A2B_PLANNING_FX_MULTIPLIER = 1.05;
export const A2B_PLANNING_PAYMENT_MULTIPLIER = 1;
export const ECB_REFERENCE_RATE_PAGE =
  "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html";

export type PurchasePlanningFx = {
  source: "ECB";
  date: string;
  baseKrwPerCny: number;
};

function dateTimestamp(date: string) {
  const timestamp = Date.parse(date);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(timestamp) && new Date(timestamp).toISOString().startsWith(date)
    ? timestamp
    : Number.NaN;
}

export function readPurchasePlanningFx(raw: unknown): PurchasePlanningFx | null {
  if (!raw || typeof raw !== "object") return null;
  const { source, date, baseKrwPerCny } = raw as Partial<PurchasePlanningFx>;
  if (source !== "ECB" || typeof date !== "string" ||
    !Number.isFinite(dateTimestamp(date)) ||
    typeof baseKrwPerCny !== "number" ||
    !Number.isFinite(baseKrwPerCny) || baseKrwPerCny <= 0) return null;
  return { source, date, baseKrwPerCny };
}

export function planningDraftRate(fx: PurchasePlanningFx) {
  return {
    planningFx: fx,
    exchangeRateKrwPerCny: fx.baseKrwPerCny * A2B_PLANNING_FX_MULTIPLIER,
    paymentFeeMultiplier: A2B_PLANNING_PAYMENT_MULTIPLIER,
  };
}

export function readConsistentPurchasePlanningFx(values: unknown[]): PurchasePlanningFx | null {
  const quotes = values.map(readPurchasePlanningFx).filter((quote) => quote !== null);
  const quote = quotes[0];
  if (quote && quotes.some((row) =>
    row.date !== quote.date || row.baseKrwPerCny !== quote.baseKrwPerCny)) {
    throw new Error("PURCHASE_DRAFT_FX_CONFLICT");
  }
  return quote ?? null;
}

export function parseEcbDailyPurchaseFx(xml: string, now: Date): PurchasePlanningFx {
  const dates = [...xml.matchAll(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>/g)];
  const date = dates[0]?.[1] ?? "";
  const ageInDays = (Date.parse(now.toISOString().slice(0, 10)) - dateTimestamp(date)) / 86_400_000;
  if (dates.length !== 1 || !(ageInDays >= 0 && ageInDays <= 7)) {
    throw new Error("ECB_PURCHASE_FX_DATE_INVALID");
  }
  const dailyRates = xml.slice(dates[0].index).split("</Cube>", 1)[0];
  const rates = [...dailyRates.matchAll(
    /<Cube\s+currency=['"](CNY|KRW)['"]\s+rate=['"](\d+(?:\.\d+)?)['"]\s*\/>/g,
  )];
  const eurToCny = Number(rates.find((row) => row[1] === "CNY")?.[2]);
  const eurToKrw = Number(rates.find((row) => row[1] === "KRW")?.[2]);
  const fx = readPurchasePlanningFx({ source: "ECB", date, baseKrwPerCny: eurToKrw / eurToCny });
  if (rates.length !== 2 || !fx || !Number.isFinite(eurToCny) || eurToCny <= 0) {
    throw new Error("ECB_PURCHASE_FX_RATES_INVALID");
  }
  return fx;
}

export async function loadPurchasePlanningFx(): Promise<PurchasePlanningFx> {
  try {
    const response = await fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", {
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`ECB_PURCHASE_FX_HTTP:${response.status}`);
    return parseEcbDailyPurchaseFx(await response.text(), new Date());
  } catch (cause) {
    throw new Error("ECB 기준환율을 확인하지 못했습니다. 잠시 후 다시 열어 주세요.", { cause });
  }
}
