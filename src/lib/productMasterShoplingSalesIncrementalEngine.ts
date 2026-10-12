import type { ProductMasterSalesMonthlyRow } from "@/lib/productMasterShoplingSalesBackfillEngine";

export const SHOPLING_CANONICAL_SALES_SOURCE = "shopling_orders_24m_v1" as const;

export type IncrementalSalesSnapshotRow = {
  id: string;
  skuId: string;
  month: string;
  quantity: number;
  revenue: number;
  lastSaleAt: string | null;
  source: string;
  syncedAt?: string | null;
};

export type IncrementalPlanningRow = {
  skuId: string;
  barcode: string;
  skuActive?: boolean;
};

export type IncrementalWriteRow = ProductMasterSalesMonthlyRow & {
  skuId: string;
};

export type IncrementalBlocker = {
  code:
    | "SKU_NOT_CURRENT"
    | "TARGET_ROW_CONFLICT"
    | "LEGACY_MONTH_OVERLAP"
    | "UNEXPECTED_ROLLING_DROP";
  barcode: string;
  skuId: string | null;
  month: string;
  message: string;
};

export type IncrementalReconcilePlan = {
  months: string[];
  freshRows: IncrementalWriteRow[];
  zeroRows: IncrementalWriteRow[];
  writeRows: IncrementalWriteRow[];
  blockers: IncrementalBlocker[];
};

const MANAGED_BARCODE = /^B[A-Z]{2}\d+-\d+$/;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function normalizedIso(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : raw;
}

function normalizeBarcode(value: unknown) {
  return text(value).normalize("NFKC").toUpperCase().replace(/\s+/g, "");
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function monthOnly(value: Date) {
  return value.toISOString().slice(0, 7);
}

function validDate(value: Date) {
  return Number.isFinite(value.valueOf());
}

export function buildShoplingIncrementalWindow(
  now = new Date(),
  previousMonths = 3,
) {
  if (!validDate(now)) throw new Error("SHOPLING_INCREMENTAL_NOW_INVALID");
  const boundedMonths = Math.max(1, Math.min(12, Math.trunc(previousMonths)));
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - boundedMonths, 1),
  );
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const months: string[] = [];
  for (
    let cursor = new Date(start);
    cursor <= end;
    cursor = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1),
    )
  ) {
    months.push(monthOnly(cursor));
  }
  return {
    startDate: dateOnly(start),
    endDate: dateOnly(end),
    months,
  };
}

function planningIndexes(planningRows: IncrementalPlanningRow[]) {
  const skuByBarcode = new Map<string, string>();
  const barcodeBySku = new Map<string, string>();
  const ambiguousBarcodes = new Set<string>();
  const ambiguousSkus = new Set<string>();

  for (const row of planningRows) {
    const skuId = text(row.skuId);
    const barcode = normalizeBarcode(row.barcode);
    if (!skuId || !MANAGED_BARCODE.test(barcode)) continue;

    // Inactive B-prefixed SKUs still own real historical sales. They remain
    // addressable for canonical monthly history even though downstream active
    // inventory/price/order decisions can separately ignore inactive SKUs.
    const existingSku = skuByBarcode.get(barcode);
    if (existingSku && existingSku !== skuId) ambiguousBarcodes.add(barcode);
    else skuByBarcode.set(barcode, skuId);

    const existingBarcode = barcodeBySku.get(skuId);
    if (existingBarcode && existingBarcode !== barcode) ambiguousSkus.add(skuId);
    else barcodeBySku.set(skuId, barcode);
  }

  for (const barcode of ambiguousBarcodes) skuByBarcode.delete(barcode);
  for (const skuId of ambiguousSkus) barcodeBySku.delete(skuId);
  return { skuByBarcode, barcodeBySku };
}

function sameTargetIdentity(
  fresh: IncrementalWriteRow,
  existing: IncrementalSalesSnapshotRow,
) {
  return (
    existing.id === fresh.id &&
    existing.skuId === fresh.skuId &&
    existing.month === fresh.month &&
    existing.source === SHOPLING_CANONICAL_SALES_SOURCE
  );
}

function canonicalRow(
  row: ProductMasterSalesMonthlyRow,
  skuId: string,
): IncrementalWriteRow {
  return {
    id: text(row.id),
    barcode: normalizeBarcode(row.barcode),
    skuId,
    month: text(row.month),
    quantity: integer(row.quantity),
    revenue: integer(row.revenue),
    lastSaleAt: row.lastSaleAt ?? null,
    source: SHOPLING_CANONICAL_SALES_SOURCE,
  };
}

function rollingVolumeGuard(input: {
  freshRows: IncrementalWriteRow[];
  existingRows: IncrementalSalesSnapshotRow[];
  monthSet: Set<string>;
  months: string[];
}): IncrementalBlocker | null {
  const existingQuantity = input.existingRows
    .filter(
      (row) =>
        row.source === SHOPLING_CANONICAL_SALES_SOURCE &&
        input.monthSet.has(text(row.month)),
    )
    .reduce((sum, row) => sum + integer(row.quantity), 0);
  const freshQuantity = input.freshRows.reduce(
    (sum, row) => sum + integer(row.quantity),
    0,
  );

  if (existingQuantity >= 20 && freshQuantity * 2 < existingQuantity) {
    return {
      code: "UNEXPECTED_ROLLING_DROP",
      barcode: "",
      skuId: null,
      month:
        input.months.length > 1
          ? `${input.months[0]}..${input.months.at(-1)}`
          : (input.months[0] ?? ""),
      message: `최근 증분 재계산 수량 ${freshQuantity}개가 기존 동일 기간 ${existingQuantity}개의 절반 미만이라 Shopling 부분응답 가능성을 배제할 수 없어 자동 갱신을 차단했습니다.`,
    };
  }
  return null;
}

export function buildShoplingIncrementalReconcilePlan(input: {
  freshRows: ProductMasterSalesMonthlyRow[];
  existingRows: IncrementalSalesSnapshotRow[];
  planningRows: IncrementalPlanningRow[];
  months: string[];
}): IncrementalReconcilePlan {
  const months = [...new Set(input.months.map(text).filter(Boolean))].sort();
  const monthSet = new Set(months);
  const { skuByBarcode, barcodeBySku } = planningIndexes(input.planningRows);
  const existingById = new Map(input.existingRows.map((row) => [text(row.id), row]));
  const otherBySkuMonth = new Map<string, IncrementalSalesSnapshotRow[]>();
  for (const row of input.existingRows) {
    if (row.source === SHOPLING_CANONICAL_SALES_SOURCE) continue;
    const key = `${text(row.skuId)}\u0000${text(row.month)}`;
    otherBySkuMonth.set(key, [...(otherBySkuMonth.get(key) ?? []), row]);
  }

  const blockers: IncrementalBlocker[] = [];
  const freshRows: IncrementalWriteRow[] = [];
  const freshIds = new Set<string>();

  for (const raw of input.freshRows) {
    const barcode = normalizeBarcode(raw.barcode);
    const month = text(raw.month);
    if (!monthSet.has(month)) continue;
    const skuId = skuByBarcode.get(barcode);
    if (!skuId) {
      blockers.push({
        code: "SKU_NOT_CURRENT",
        barcode,
        skuId: null,
        month,
        message: "증분 판매원장 위치코드를 상품마스터의 고유 B코드 SKU에서 찾지 못했습니다.",
      });
      continue;
    }
    const row = canonicalRow(raw, skuId);
    freshIds.add(row.id);
    const target = existingById.get(row.id);
    if (target && !sameTargetIdentity(row, target)) {
      blockers.push({
        code: "TARGET_ROW_CONFLICT",
        barcode,
        skuId,
        month,
        message: "같은 Shopling 판매원장 ID가 다른 SKU·월·원천에 연결되어 있어 자동 갱신을 차단했습니다.",
      });
      continue;
    }
    const overlaps = otherBySkuMonth.get(`${skuId}\u0000${month}`) ?? [];
    if (overlaps.some((existing) => integer(existing.quantity) > 0 || integer(existing.revenue) > 0)) {
      blockers.push({
        code: "LEGACY_MONTH_OVERLAP",
        barcode,
        skuId,
        month,
        message: "같은 SKU·월에 다른 원천의 판매원장이 있어 이중계상 위험 때문에 증분 갱신을 차단했습니다.",
      });
      continue;
    }
    freshRows.push(row);
  }

  const volumeBlocker = rollingVolumeGuard({
    freshRows,
    existingRows: input.existingRows,
    monthSet,
    months,
  });
  if (volumeBlocker) blockers.push(volumeBlocker);

  const zeroRows: IncrementalWriteRow[] = [];
  for (const existing of input.existingRows) {
    if (existing.source !== SHOPLING_CANONICAL_SALES_SOURCE) continue;
    if (!monthSet.has(text(existing.month))) continue;
    if (freshIds.has(text(existing.id))) continue;
    const barcode = barcodeBySku.get(text(existing.skuId));
    if (!barcode) {
      blockers.push({
        code: "SKU_NOT_CURRENT",
        barcode: "",
        skuId: text(existing.skuId) || null,
        month: text(existing.month),
        message: "기존 Shopling 월 판매원장의 SKU를 상품마스터 고유 B코드로 되돌릴 수 없어 0 보정을 차단했습니다.",
      });
      continue;
    }
    const expectedId = `shopling-sales-v1:${barcode}:${text(existing.month)}`;
    if (text(existing.id) !== expectedId) {
      const priorIdentity = /^shopling-sales-v1:(B[A-Z]{2}\d+-\d+):(\d{4}-\d{2})$/.exec(
        text(existing.id),
      );
      if (!priorIdentity || priorIdentity[2] !== text(existing.month)) {
        blockers.push({
          code: "TARGET_ROW_CONFLICT",
          barcode,
          skuId: text(existing.skuId),
          month: text(existing.month),
          message: "기존 Shopling 판매원장 ID가 안전하게 식별할 수 없는 형식이라 자동 0 보정을 차단했습니다.",
        });
        continue;
      }
      // A B-code rename leaves the old deterministic row behind. Zero that
      // exact row while the fresh row is written under the current B-code, so
      // one SKU-month is never counted twice and the history remains auditable.
      zeroRows.push({
        id: text(existing.id),
        barcode,
        skuId: text(existing.skuId),
        month: text(existing.month),
        quantity: 0,
        revenue: 0,
        lastSaleAt: null,
        source: SHOPLING_CANONICAL_SALES_SOURCE,
      });
      continue;
    }
    zeroRows.push({
      id: expectedId,
      barcode,
      skuId: text(existing.skuId),
      month: text(existing.month),
      quantity: 0,
      revenue: 0,
      lastSaleAt: null,
      source: SHOPLING_CANONICAL_SALES_SOURCE,
    });
  }

  const writeRows = [...freshRows, ...zeroRows].sort((left, right) =>
    `${left.month}\u0000${left.barcode}`.localeCompare(
      `${right.month}\u0000${right.barcode}`,
    ),
  );
  return { months, freshRows, zeroRows, writeRows, blockers };
}

export function exactShoplingIncrementalSales(
  expected: IncrementalWriteRow,
  actual: IncrementalSalesSnapshotRow,
) {
  return (
    text(actual.id) === expected.id &&
    text(actual.skuId) === expected.skuId &&
    text(actual.month) === expected.month &&
    integer(actual.quantity) === expected.quantity &&
    integer(actual.revenue) === expected.revenue &&
    normalizedIso(actual.lastSaleAt) === normalizedIso(expected.lastSaleAt) &&
    actual.source === SHOPLING_CANONICAL_SALES_SOURCE
  );
}
