import type { FreightApplicationItem } from "../types/freightBarcodeRequest.ts";

export const FREIGHT_MONTHLY_ORDER_CONTEXT_STORAGE_KEY =
  "commerce-os:freight-monthly-order-context:v1";
const CONTEXT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const B_CODE = /^B[A-Z]{2}\d+-\d+$/;

export type FreightMonthlyOrderLine = {
  barcode: string;
  modelNo: string;
  modelName: string;
  saleOption: string;
  chinaOption: string;
  orderNumber: string;
  supplierLink: string;
  quantity: number;
};

export type FreightMonthlyOrderContext = {
  cycleMonth: string;
  draftId?: string;
  orderCount: number;
  lineCount: number;
  totalQuantity: number;
  savedAt: number;
  lines: FreightMonthlyOrderLine[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function compact(value: unknown) {
  return text(value)
    .toLowerCase()
    .replace(/[\s\-_/()\[\]{},.:：]+/g, "");
}

function orderKey(value: unknown) {
  return text(value).replace(/\s+/g, "").toUpperCase();
}

function offerId(value: unknown) {
  return text(value).match(/(?:offer\/|offerId=)(\d{6,})/i)?.[1] ?? "";
}

function overlap(left: unknown, right: unknown) {
  const a = compact(left);
  const b = compact(right);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

function validContext(value: unknown): value is FreightMonthlyOrderContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    /^\d{4}-\d{2}$/.test(text(row.cycleMonth)) &&
    (row.draftId === undefined ||
      /^fast-purchase-draft:[a-f0-9]{20}$/.test(text(row.draftId))) &&
    Number.isFinite(Number(row.savedAt)) &&
    Array.isArray(row.lines)
  );
}

function candidateScore(item: FreightApplicationItem, line: FreightMonthlyOrderLine) {
  let score = 0;
  const itemOrder = orderKey(item.orderNo || item.trackingNo);
  const lineOrder = orderKey(line.orderNumber);
  if (itemOrder && lineOrder && itemOrder === lineOrder) score += 1_000;

  const itemOffer = offerId(item.detailUrl);
  const lineOffer = offerId(line.supplierLink);
  if (itemOffer && lineOffer && itemOffer === lineOffer) score += 400;

  if (overlap(item.optionText, line.chinaOption)) score += 160;
  if (overlap(item.optionText, line.saleOption)) score += 120;
  if (overlap(item.itemName, line.modelName)) score += 50;
  if (item.quantity > 0 && item.quantity === line.quantity) score += 25;
  return score;
}

function chooseUniqueBest(
  values: Array<{ index: number; score: number }>,
  minimumScore: number,
) {
  if (!values.length) return -1;
  const sorted = [...values].sort(
    (left, right) => right.score - left.score || left.index - right.index,
  );
  if (sorted[0].score < minimumScore) return -1;
  if (sorted.length > 1 && sorted[0].score === sorted[1].score) return -1;
  return sorted[0].index;
}

function chooseLineIndex(
  item: FreightApplicationItem,
  lines: FreightMonthlyOrderLine[],
  used: Set<number>,
) {
  const available = lines
    .map((line, index) => ({ line, index, score: candidateScore(item, line) }))
    .filter(({ index }) => !used.has(index));
  if (!available.length) return -1;

  const itemOrder = orderKey(item.orderNo || item.trackingNo);
  if (itemOrder) {
    const exactOrder = available.filter(
      ({ line }) => orderKey(line.orderNumber) === itemOrder,
    );
    if (exactOrder.length === 1) return exactOrder[0].index;
    if (exactOrder.length > 1) {
      return chooseUniqueBest(exactOrder, 1_001);
    }
  }

  const itemOffer = offerId(item.detailUrl);
  if (itemOffer) {
    const exactOffer = available.filter(
      ({ line }) => offerId(line.supplierLink) === itemOffer,
    );
    if (exactOffer.length === 1) return exactOffer[0].index;
    if (exactOffer.length > 1) {
      return chooseUniqueBest(exactOffer, 401);
    }
  }

  return chooseUniqueBest(available, 120);
}

function appendMonthlyMemo(
  current: string | undefined,
  context: FreightMonthlyOrderContext,
  line: FreightMonthlyOrderLine,
) {
  const marker = `월간 발주 자동연동 ${context.cycleMonth}`;
  const existing = text(current);
  if (existing.includes(marker)) return existing;
  const suffix = line.orderNumber ? ` · 주문 ${line.orderNumber}` : "";
  return [existing, `${marker}${suffix}`].filter(Boolean).join(" · ");
}

export function applyFreightMonthlyOrderContext(
  items: FreightApplicationItem[],
  context: FreightMonthlyOrderContext | null,
) {
  if (!context?.lines.length) return { items, matchedCount: 0 };
  const used = new Set<number>();
  let matchedCount = 0;

  const next = items.map((item) => {
    const index = chooseLineIndex(item, context.lines, used);
    if (index < 0) return item;
    const line = context.lines[index];
    used.add(index);
    matchedCount += 1;

    const barcode = B_CODE.test(line.barcode) ? line.barcode : item.barcode;
    return {
      ...item,
      locationCode: barcode || item.locationCode,
      barcode: barcode || item.barcode,
      modelNo: line.modelNo || item.modelNo,
      modelName: line.modelName || item.modelName,
      optionName: line.saleOption || line.chinaOption || item.optionName,
      matchedModelNo: line.modelNo || item.matchedModelNo,
      matchedModelName: line.modelName || item.matchedModelName,
      matchedProductNameKo: line.modelName || item.matchedProductNameKo,
      matchedBarcode: barcode || item.matchedBarcode,
      memo: appendMonthlyMemo(item.memo, context, line),
    } satisfies FreightApplicationItem;
  });

  return { items: next, matchedCount };
}

export function persistFreightMonthlyOrderContext(
  context: FreightMonthlyOrderContext,
) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(
    FREIGHT_MONTHLY_ORDER_CONTEXT_STORAGE_KEY,
    JSON.stringify(context),
  );
}

export function readActiveFreightMonthlyOrderContext() {
  if (typeof window === "undefined") return null;
  try {
    const requestedMonth = new URLSearchParams(window.location.search).get("month");
    if (!requestedMonth) return null;
    const raw = window.sessionStorage.getItem(
      FREIGHT_MONTHLY_ORDER_CONTEXT_STORAGE_KEY,
    );
    if (!raw) return null;
    const context = JSON.parse(raw) as unknown;
    if (!validContext(context)) return null;
    if (context.cycleMonth !== requestedMonth) return null;
    if (Date.now() - context.savedAt > CONTEXT_MAX_AGE_MS) return null;
    return context;
  } catch {
    return null;
  }
}

export function applyActiveFreightMonthlyOrderContext(
  items: FreightApplicationItem[],
) {
  return applyFreightMonthlyOrderContext(
    items,
    readActiveFreightMonthlyOrderContext(),
  ).items;
}
