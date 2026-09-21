import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const INTERNAL_CHINA_PURCHASE_PREP_OPERATION_TYPE =
  "INTERNAL_CHINA_PURCHASE_PREP";

const READ_LIMIT = 120;

export type InternalChinaMonthlyPurchaseLine = {
  draftId: string;
  barcode: string;
  modelNo: string;
  modelName: string;
  saleOption: string;
  chinaOption: string;
  orderNumber: string;
  supplierLink: string;
  quantity: number;
  goodsPaidCny: number;
  domesticChinaFreightCny: number;
  serviceFeeCny: number;
  actualLinePaidCny: number;
  actualLinePaidKrwAtInternalFx: number;
  assigned: boolean;
};

export type InternalChinaMonthlyPurchaseSummary = {
  cycleMonth: string;
  draftCount: number;
  orderCount: number;
  lineCount: number;
  skuCount: number;
  totalQuantity: number;
  goodsPaidCny: number;
  domesticChinaFreightCny: number;
  serviceFeeCny: number;
  actualOrderPaidCny: number;
  actualOrderPaidKrwAtInternalFx: number;
  exchangeRateKrwPerCny: number;
  assignedLineCount: number;
  unassignedLineCount: number;
  importedFromActualOrder: boolean;
  cashFlowEarlyClose: boolean;
  latestRecordedAt: string | null;
  lines: InternalChinaMonthlyPurchaseLine[];
};

type StoredRow = {
  source_event_id?: unknown;
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  started_at?: unknown;
  updated_at?: unknown;
};

type ParsedDraft = Omit<
  InternalChinaMonthlyPurchaseSummary,
  "draftCount" | "skuCount"
> & {
  draftId: string;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function decimal(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.round(parsed * 10_000) / 10_000)
    : 0;
}

function iso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function snapshotFrom(row: StoredRow) {
  const result = object(row.result_snapshot);
  const nested = object(result.snapshot);
  if (Object.keys(nested).length) return nested;
  if (Object.keys(result).length) return result;
  return object(row.input_snapshot);
}

function parseLine(
  value: unknown,
  draftId: string,
  exchangeRateKrwPerCny: number,
): InternalChinaMonthlyPurchaseLine | null {
  const row = object(value);
  const barcode = text(row.barcode).toUpperCase().replace(/\s+/g, "");
  const modelNo = text(row.modelNo);
  const modelName = text(row.modelName || row.productName);
  const orderNumber = text(row.orderNumber);
  const quantity = integer(row.quantity);
  const goodsPaidCny = decimal(
    row.goodsPaidCny ?? decimal(row.unitPriceCny) * quantity,
  );
  const domesticChinaFreightCny = decimal(row.domesticChinaFreightCny);
  const serviceFeeCny = decimal(row.serviceFeeCny);
  const actualLinePaidCny = decimal(
    row.actualLinePaidCny ??
      row.actualOrderPaidCny ??
      goodsPaidCny + domesticChinaFreightCny + serviceFeeCny,
  );
  const actualLinePaidKrwAtInternalFx = integer(
    row.actualLinePaidKrwAtInternalFx ??
      actualLinePaidCny * exchangeRateKrwPerCny,
  );

  if (!barcode && !modelNo && !modelName && !orderNumber) return null;

  return {
    draftId,
    barcode: barcode || "UNASSIGNED",
    modelNo,
    modelName,
    saleOption: text(row.saleOption),
    chinaOption: text(row.chinaOption),
    orderNumber,
    supplierLink: text(row.supplierLink),
    quantity,
    goodsPaidCny,
    domesticChinaFreightCny,
    serviceFeeCny,
    actualLinePaidCny,
    actualLinePaidKrwAtInternalFx,
    assigned:
      row.assigned !== false &&
      Boolean(barcode) &&
      !barcode.startsWith("UNASSIGNED"),
  };
}

function parseDraft(row: StoredRow): ParsedDraft | null {
  const snapshot = snapshotFrom(row);
  const cycleMonth = text(snapshot.cycleMonth);
  if (!/^\d{4}-\d{2}$/.test(cycleMonth)) return null;

  const draftId = text(snapshot.draftId) || text(row.source_event_id);
  const exchangeRateKrwPerCny =
    decimal(snapshot.exchangeRateKrwPerCny) || 230;
  const sourceLines = Array.isArray(snapshot.lines) ? snapshot.lines : [];
  const lines = sourceLines
    .map((line) => parseLine(line, draftId, exchangeRateKrwPerCny))
    .filter((line): line is InternalChinaMonthlyPurchaseLine => Boolean(line));

  const goodsPaidCny =
    decimal(snapshot.goodsPaidCny) ||
    decimal(lines.reduce((sum, line) => sum + line.goodsPaidCny, 0));
  const domesticChinaFreightCny =
    decimal(snapshot.domesticChinaFreightCny) ||
    decimal(
      lines.reduce((sum, line) => sum + line.domesticChinaFreightCny, 0),
    );
  const serviceFeeCny =
    decimal(snapshot.serviceFeeCny) ||
    decimal(lines.reduce((sum, line) => sum + line.serviceFeeCny, 0));
  const actualOrderPaidCny =
    decimal(snapshot.actualOrderPaidCny) ||
    decimal(goodsPaidCny + domesticChinaFreightCny + serviceFeeCny);
  const actualOrderPaidKrwAtInternalFx =
    integer(snapshot.actualOrderPaidKrwAtInternalFx) ||
    integer(actualOrderPaidCny * exchangeRateKrwPerCny);
  const assignedLineCount =
    integer(snapshot.assignedLineCount) ||
    lines.filter((line) => line.assigned).length;
  const unassignedLineCount =
    integer(snapshot.unassignedLineCount) ||
    lines.filter((line) => !line.assigned).length;

  return {
    draftId,
    cycleMonth,
    orderCount: integer(snapshot.orderCount),
    lineCount: integer(snapshot.lineCount) || lines.length,
    totalQuantity:
      integer(snapshot.totalQuantity) ||
      lines.reduce((sum, line) => sum + line.quantity, 0),
    goodsPaidCny,
    domesticChinaFreightCny,
    serviceFeeCny,
    actualOrderPaidCny,
    actualOrderPaidKrwAtInternalFx,
    exchangeRateKrwPerCny,
    assignedLineCount,
    unassignedLineCount,
    importedFromActualOrder: snapshot.importedFromActualOrder === true,
    cashFlowEarlyClose: snapshot.cashFlowEarlyClose === true,
    latestRecordedAt:
      iso(snapshot.savedAt) ||
      iso(snapshot.updatedAt) ||
      iso(row.updated_at) ||
      iso(row.started_at),
    lines,
  };
}

function aggregateDrafts(
  cycleMonth: string,
  drafts: ParsedDraft[],
): InternalChinaMonthlyPurchaseSummary {
  const lines = drafts.flatMap((draft) => draft.lines);
  const uniqueSku = new Set(
    lines
      .map((line) => line.barcode)
      .filter((barcode) => barcode && !barcode.startsWith("UNASSIGNED")),
  );
  const latestRecordedAt =
    drafts
      .map((draft) => draft.latestRecordedAt)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => right.localeCompare(left))[0] ?? null;
  const exchangeRateKrwPerCny =
    drafts.find((draft) => draft.exchangeRateKrwPerCny > 0)
      ?.exchangeRateKrwPerCny ?? 230;

  return {
    cycleMonth,
    draftCount: drafts.length,
    orderCount: drafts.reduce((sum, draft) => sum + draft.orderCount, 0),
    lineCount: drafts.reduce((sum, draft) => sum + draft.lineCount, 0),
    skuCount: uniqueSku.size,
    totalQuantity: drafts.reduce((sum, draft) => sum + draft.totalQuantity, 0),
    goodsPaidCny: decimal(
      drafts.reduce((sum, draft) => sum + draft.goodsPaidCny, 0),
    ),
    domesticChinaFreightCny: decimal(
      drafts.reduce(
        (sum, draft) => sum + draft.domesticChinaFreightCny,
        0,
      ),
    ),
    serviceFeeCny: decimal(
      drafts.reduce((sum, draft) => sum + draft.serviceFeeCny, 0),
    ),
    actualOrderPaidCny: decimal(
      drafts.reduce((sum, draft) => sum + draft.actualOrderPaidCny, 0),
    ),
    actualOrderPaidKrwAtInternalFx: drafts.reduce(
      (sum, draft) => sum + draft.actualOrderPaidKrwAtInternalFx,
      0,
    ),
    exchangeRateKrwPerCny,
    assignedLineCount: drafts.reduce(
      (sum, draft) => sum + draft.assignedLineCount,
      0,
    ),
    unassignedLineCount: drafts.reduce(
      (sum, draft) => sum + draft.unassignedLineCount,
      0,
    ),
    importedFromActualOrder: drafts.some(
      (draft) => draft.importedFromActualOrder,
    ),
    cashFlowEarlyClose: drafts.some((draft) => draft.cashFlowEarlyClose),
    latestRecordedAt,
    lines: lines.sort((left, right) => {
      const unassigned = Number(left.assigned) - Number(right.assigned);
      if (unassigned !== 0) return unassigned;
      return (
        left.orderNumber.localeCompare(right.orderNumber) ||
        left.barcode.localeCompare(right.barcode)
      );
    }),
  };
}

async function readRecentRows() {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const result = await admin
    .from("commerce_operation_runs")
    .select(
      "source_event_id,input_snapshot,result_snapshot,started_at,updated_at",
    )
    .eq("operation_type", INTERNAL_CHINA_PURCHASE_PREP_OPERATION_TYPE)
    .eq("status", "SUCCEEDED")
    .order("started_at", { ascending: false })
    .limit(READ_LIMIT);
  if (result.error) {
    throw new Error(
      `INTERNAL_CHINA_MONTHLY_PURCHASE_READ_FAILED:${result.error.message}`,
    );
  }
  return (result.data ?? []) as StoredRow[];
}

export async function loadRecentInternalChinaMonthlyPurchaseSummaries(
  limitInput: unknown = 12,
): Promise<InternalChinaMonthlyPurchaseSummary[]> {
  const parsedLimit = Math.round(Number(limitInput));
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(24, Math.max(1, parsedLimit))
    : 12;
  const rows = await readRecentRows();
  const byDraft = new Map<string, ParsedDraft>();
  for (const row of rows) {
    const parsed = parseDraft(row);
    if (!parsed) continue;
    const key = `${parsed.cycleMonth}:${parsed.draftId}`;
    if (!byDraft.has(key)) byDraft.set(key, parsed);
  }
  const byMonth = new Map<string, ParsedDraft[]>();
  for (const draft of byDraft.values()) {
    byMonth.set(draft.cycleMonth, [
      ...(byMonth.get(draft.cycleMonth) ?? []),
      draft,
    ]);
  }
  return [...byMonth.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .slice(0, limit)
    .map(([cycleMonth, drafts]) => aggregateDrafts(cycleMonth, drafts));
}

export async function loadInternalChinaMonthlyPurchaseSummary(
  cycleMonthInput: unknown,
): Promise<InternalChinaMonthlyPurchaseSummary | null> {
  const cycleMonth = text(cycleMonthInput);
  if (!/^\d{4}-\d{2}$/.test(cycleMonth)) {
    throw new Error("INTERNAL_CHINA_MONTHLY_PURCHASE_CYCLE_INVALID");
  }
  const summaries = await loadRecentInternalChinaMonthlyPurchaseSummaries(24);
  return summaries.find((summary) => summary.cycleMonth === cycleMonth) ?? null;
}

/** Complete caller-owned evidence, without the recent-dashboard read limit. */
export function buildInternalChinaMonthlyPurchaseSummaryFromRows(rows: readonly StoredRow[], cycleMonth: string): InternalChinaMonthlyPurchaseSummary | null {
  const byDraft = new Map<string, ParsedDraft>();
  for (const row of rows) {
    const parsed = parseDraft(row);
    if (parsed?.cycleMonth === cycleMonth && !byDraft.has(parsed.draftId)) byDraft.set(parsed.draftId, parsed);
  }
  return byDraft.size ? aggregateDrafts(cycleMonth, [...byDraft.values()]) : null;
}
