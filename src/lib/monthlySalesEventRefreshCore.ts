import type {
  ProductMasterSalesEventRow,
  ProductMasterShoplingSalesEventChunk,
} from "@/lib/productMasterShoplingSalesEventEngine";
import type { ShoplingDateRange } from "@/lib/shopling/shoplingReadClient";

const DAY_MS = 24 * 60 * 60 * 1000;

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("MONTHLY_SALES_EVENT_RANGE_DATE_INVALID");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.valueOf()) || dateOnly(parsed) !== value) {
    throw new Error("MONTHLY_SALES_EVENT_RANGE_DATE_INVALID");
  }
  return parsed;
}

function addDays(value: Date, days: number) {
  return new Date(value.valueOf() + days * DAY_MS);
}

function rangeKey(range: ShoplingDateRange) {
  return `${range.start}:${range.end}`;
}

function splitRange(start: Date, end: Date, chunkDays: number) {
  const ranges: ShoplingDateRange[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, chunkDays)) {
    ranges.push({
      start: dateOnly(cursor),
      end: dateOnly(new Date(Math.min(end.valueOf(), addDays(cursor, chunkDays - 1).valueOf()))),
    });
  }
  return ranges;
}

export type MonthlySalesEventReusePlan = {
  ranges: ShoplingDateRange[];
  reusableRangeKeys: string[];
  sourceReadRangeCount: number;
  correctionStartDate: string;
};

/**
 * Preserve exact, already-read source ranges before the correction window and
 * reread every uncovered/recent day. Shopling can surface an old order in a
 * recent source range after a late status change; the newer duplicate wins
 * when chunks are combined.
 */
export function buildMonthlySalesEventReusePlan(input: {
  analysisStartDate: string;
  analysisEndDate: string;
  parentRanges: ShoplingDateRange[];
  correctionDays: number;
  chunkDays: number;
}): MonthlySalesEventReusePlan {
  const start = parseDate(input.analysisStartDate);
  const end = parseDate(input.analysisEndDate);
  if (start > end) throw new Error("MONTHLY_SALES_EVENT_RANGE_INVALID");
  const correctionDays = Math.max(30, Math.min(90, Math.trunc(input.correctionDays)));
  const chunkDays = Math.max(1, Math.min(31, Math.trunc(input.chunkDays)));
  const correctionStart = new Date(
    Math.max(start.valueOf(), addDays(end, -(correctionDays - 1)).valueOf()),
  );

  const reusable = input.parentRanges
    .map((range) => ({ range, start: parseDate(range.start), end: parseDate(range.end) }))
    .filter(({ start: rangeStart, end: rangeEnd }) =>
      rangeStart >= start &&
      rangeEnd >= rangeStart &&
      rangeEnd < correctionStart &&
      rangeEnd <= end,
    )
    .sort((left, right) => left.start.valueOf() - right.start.valueOf());

  const ranges: ShoplingDateRange[] = [];
  const reusableRangeKeys: string[] = [];
  let cursor = new Date(start);
  for (const item of reusable) {
    if (item.start < cursor) continue;
    if (item.start > cursor) {
      ranges.push(...splitRange(cursor, addDays(item.start, -1), chunkDays));
    }
    ranges.push(item.range);
    reusableRangeKeys.push(rangeKey(item.range));
    cursor = addDays(item.end, 1);
  }
  if (cursor <= end) ranges.push(...splitRange(cursor, end, chunkDays));

  const unique = new Set(ranges.map(rangeKey));
  if (unique.size !== ranges.length) {
    throw new Error("MONTHLY_SALES_EVENT_RANGE_OVERLAP");
  }
  return {
    ranges,
    reusableRangeKeys,
    sourceReadRangeCount: ranges.length - reusableRangeKeys.length,
    correctionStartDate: dateOnly(correctionStart),
  };
}

function eventInsideAnalysisWindow(event: ProductMasterSalesEventRow, analysisAsOf: string) {
  const occurredAt = Date.parse(event.occurredAt);
  const end = Date.parse(analysisAsOf);
  return (
    Number.isFinite(occurredAt) &&
    Number.isFinite(end) &&
    occurredAt >= end - 360 * DAY_MS &&
    occurredAt < end
  );
}

export function trimReusedSalesEventChunk(
  chunk: ProductMasterShoplingSalesEventChunk,
  analysisAsOf: string,
): ProductMasterShoplingSalesEventChunk {
  const events = chunk.events.filter((event) =>
    eventInsideAnalysisWindow(event, analysisAsOf),
  );
  const validRows = events.filter((event) => event.validSale);
  const removed = chunk.events.length - events.length;
  return {
    ...chunk,
    eventRows: events.length,
    validRows: validRows.length,
    tombstoneRows: events.length - validRows.length,
    ignoredRows: chunk.ignoredRows + removed,
    duplicateRows: chunk.duplicateRows,
    totalBaseUnits: validRows.reduce((sum, event) => sum + event.quantity, 0),
    totalRevenue: validRows.reduce((sum, event) => sum + event.revenue, 0),
    events,
    unmappedRows: 0,
    unmappedSamples: [],
  };
}
