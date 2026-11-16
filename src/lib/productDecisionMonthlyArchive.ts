import { seoulCalendarMonth, koreanMonthLabel } from "@/lib/monthlyPurchasePolicy";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const FUNDING_CLOSE_OPERATION = "INTERNAL_CHINA_MONTHLY_FUNDING_CLOSE";
const PURCHASE_PREP_OPERATION = "INTERNAL_CHINA_PURCHASE_PREP";
const LIVE_REFRESH_REQUEST_OPERATION = "PRODUCT_DECISION_LIVE_REFRESH_REQUEST";
const HISTORY_LIMIT = 120;

export type ProductDecisionMonthState = "CURRENT" | "CLOSED" | "ARCHIVED";

export type ProductDecisionMonthOption = {
  cycleMonth: string;
  label: string;
  state: ProductDecisionMonthState;
  readOnly: boolean;
  closedAt: string | null;
  monthlyRunCreated: boolean;
  lineCount: number;
  totalQuantity: number;
};

export type ProductDecisionArchiveLine = {
  barcode: string;
  modelNo: string;
  modelName: string;
  productName: string;
  saleOption: string;
  quantity: number;
  unitPriceCny: number;
  domesticChinaFreightCny: number;
  orderNumber: string;
};

export type ProductDecisionMonthlyArchive = {
  currentCycleMonth: string;
  selectedCycleMonth: string;
  selected: ProductDecisionMonthOption;
  months: ProductDecisionMonthOption[];
  lines: ProductDecisionArchiveLine[];
  readOnly: boolean;
  closedAt: string | null;
  savedAt: string | null;
  draftId: string | null;
  lineCount: number;
  totalQuantity: number;
};

type OperationRow = {
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  started_at?: unknown;
};

type PrepSummary = {
  cycleMonth: string;
  savedAt: string | null;
  draftId: string | null;
  lines: ProductDecisionArchiveLine[];
  lineCount: number;
  totalQuantity: number;
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
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function signedDecimal(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function validMonth(value: unknown) {
  const month = text(value);
  return /^\d{4}-\d{2}$/.test(month) ? month : null;
}

function monthFromDate(value: unknown) {
  const raw = text(value);
  if (!raw || !Number.isFinite(Date.parse(raw))) return null;
  try {
    return seoulCalendarMonth(raw);
  } catch {
    return null;
  }
}

function normalizePrep(row: OperationRow): PrepSummary | null {
  const result = object(row.result_snapshot);
  const snapshot = object(result.snapshot);
  const savedAt = text(snapshot.savedAt) || text(row.started_at) || null;
  const cycleMonth = monthFromDate(savedAt);
  if (!cycleMonth) return null;

  const rawLines = Array.isArray(snapshot.lines) ? snapshot.lines : [];
  const lines = rawLines.flatMap((value): ProductDecisionArchiveLine[] => {
    const line = object(value);
    const barcode = text(line.barcode).toUpperCase();
    const quantity = integer(line.quantity);
    if (!barcode || quantity <= 0) return [];
    return [
      {
        barcode,
        modelNo: text(line.modelNo),
        modelName: text(line.modelName),
        productName: text(line.productName),
        saleOption: text(line.saleOption),
        quantity,
        unitPriceCny: decimal(line.unitPriceCny),
        domesticChinaFreightCny: signedDecimal(line.domesticChinaFreightCny),
        orderNumber: text(line.orderNumber),
      },
    ];
  });

  return {
    cycleMonth,
    savedAt,
    draftId: text(snapshot.draftId) || null,
    lines,
    lineCount: integer(snapshot.lineCount) || lines.length,
    totalQuantity:
      integer(snapshot.totalQuantity) ||
      lines.reduce((sum, line) => sum + line.quantity, 0),
  };
}

function liveRequestMonth(row: OperationRow) {
  const input = object(row.input_snapshot);
  const explicit = validMonth(input.cycleMonth);
  if (explicit) return explicit;
  return monthFromDate(input.analysisAsOf) || monthFromDate(row.started_at);
}

export async function loadProductDecisionMonthlyArchive(
  selectedMonthInput: unknown = null,
): Promise<ProductDecisionMonthlyArchive> {
  const currentCycleMonth = seoulCalendarMonth(new Date());
  const requestedMonth = validMonth(selectedMonthInput) || currentCycleMonth;
  const admin = await createSupabaseAdminClient();

  if (!admin) {
    const selected: ProductDecisionMonthOption = {
      cycleMonth: currentCycleMonth,
      label: koreanMonthLabel(currentCycleMonth),
      state: "CURRENT",
      readOnly: false,
      closedAt: null,
      monthlyRunCreated: false,
      lineCount: 0,
      totalQuantity: 0,
    };
    return {
      currentCycleMonth,
      selectedCycleMonth: currentCycleMonth,
      selected,
      months: [selected],
      lines: [],
      readOnly: false,
      closedAt: null,
      savedAt: null,
      draftId: null,
      lineCount: 0,
      totalQuantity: 0,
    };
  }

  const [fundingResult, prepResult, liveRequestResult] = await Promise.all([
    admin
      .from("commerce_operation_runs")
      .select("result_snapshot,started_at")
      .eq("operation_type", FUNDING_CLOSE_OPERATION)
      .eq("status", "SUCCEEDED")
      .order("started_at", { ascending: false })
      .limit(24),
    admin
      .from("commerce_operation_runs")
      .select("result_snapshot,started_at")
      .eq("operation_type", PURCHASE_PREP_OPERATION)
      .eq("status", "SUCCEEDED")
      .order("started_at", { ascending: false })
      .limit(48),
    admin
      .from("commerce_operation_runs")
      .select("input_snapshot,started_at")
      .eq("operation_type", LIVE_REFRESH_REQUEST_OPERATION)
      .eq("status", "SUCCEEDED")
      .order("started_at", { ascending: false })
      .limit(HISTORY_LIMIT),
  ]);

  if (fundingResult.error) throw new Error(fundingResult.error.message);
  if (prepResult.error) throw new Error(prepResult.error.message);
  if (liveRequestResult.error) throw new Error(liveRequestResult.error.message);

  const closedAtByMonth = new Map<string, string>();
  for (const raw of Array.isArray(fundingResult.data) ? fundingResult.data : []) {
    const row = raw as OperationRow;
    const snapshot = object(row.result_snapshot);
    const cycleMonth = validMonth(snapshot.cycleMonth);
    if (!cycleMonth || closedAtByMonth.has(cycleMonth)) continue;
    closedAtByMonth.set(
      cycleMonth,
      text(snapshot.closedAt) || text(row.started_at) || "",
    );
  }

  const prepByMonth = new Map<string, PrepSummary>();
  for (const raw of Array.isArray(prepResult.data) ? prepResult.data : []) {
    const prep = normalizePrep(raw as OperationRow);
    if (!prep || prepByMonth.has(prep.cycleMonth)) continue;
    prepByMonth.set(prep.cycleMonth, prep);
  }

  const runMonths = new Set<string>();
  for (const raw of Array.isArray(liveRequestResult.data)
    ? liveRequestResult.data
    : []) {
    const month = liveRequestMonth(raw as OperationRow);
    if (month) runMonths.add(month);
  }

  const monthKeys = new Set<string>([
    currentCycleMonth,
    ...closedAtByMonth.keys(),
    ...prepByMonth.keys(),
    ...runMonths,
  ]);
  const months = [...monthKeys]
    .sort((left, right) => right.localeCompare(left))
    .slice(0, 12)
    .map((cycleMonth): ProductDecisionMonthOption => {
      const prep = prepByMonth.get(cycleMonth);
      const closedAt = closedAtByMonth.get(cycleMonth) || null;
      const current = cycleMonth === currentCycleMonth;
      return {
        cycleMonth,
        label: koreanMonthLabel(cycleMonth),
        state: current ? "CURRENT" : closedAt ? "CLOSED" : "ARCHIVED",
        readOnly: !current,
        closedAt,
        monthlyRunCreated: runMonths.has(cycleMonth),
        lineCount: prep?.lineCount ?? 0,
        totalQuantity: prep?.totalQuantity ?? 0,
      };
    });

  const selectedCycleMonth = monthKeys.has(requestedMonth)
    ? requestedMonth
    : currentCycleMonth;
  const selected =
    months.find((month) => month.cycleMonth === selectedCycleMonth) ??
    months.find((month) => month.cycleMonth === currentCycleMonth)!;
  const prep = prepByMonth.get(selectedCycleMonth) ?? null;

  return {
    currentCycleMonth,
    selectedCycleMonth,
    selected,
    months,
    lines: prep?.lines ?? [],
    readOnly: selected.readOnly,
    closedAt: selected.closedAt,
    savedAt: prep?.savedAt ?? null,
    draftId: prep?.draftId ?? null,
    lineCount: prep?.lineCount ?? 0,
    totalQuantity: prep?.totalQuantity ?? 0,
  };
}
