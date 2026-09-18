import { createHash } from "node:crypto";
import {
  CHINA_ORDER_EVENT_OPERATION_TYPE,
  loadChinaOrderLedger,
  normalizeChinaOrderCommitmentEvent,
} from "@/lib/chinaOrderLedger";
import { DEFAULT_PURCHASE_COST_MULTIPLIER } from "@/lib/productDecisionEngine/portfolio";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { loadProductLaunchPurchaseMetadataByBarcode } from "@/lib/productLaunchPurchaseMetadata";
import { loadShoplingCurrentModelSnapshot } from "@/lib/shopling/shoplingCurrentModelIdentity";
import {
  createSupabaseAdminClient,
  createSupabaseAdminHeaders,
} from "@/lib/supabase/admin";

export const INTERNAL_CHINA_PURCHASE_PREP_OPERATION_TYPE =
  "INTERNAL_CHINA_PURCHASE_PREP";
export const INTERNAL_CHINA_FIXED_KRW_PER_CNY = 230;
export const INTERNAL_CHINA_ORDER_COST_MULTIPLIER =
  DEFAULT_PURCHASE_COST_MULTIPLIER;

const SOURCE_SYSTEM = "fast-purchase-mvp";
const PREP_SOURCE = "ops-center-internal-china-order";
const DRAFT_ID = /^fast-purchase-draft:[a-f0-9]{20}$/;
const BARCODE = /^[A-Z]{3}\d+-\d+$/;
const MANUAL_QUANTITY_MAX = 9_999;

export type InternalChinaPurchaseDraftStatus = "DRAFT" | "ORDERED";

export type InternalChinaPurchaseDraftLine = {
  barcode: string;
  modelNo: string;
  modelName: string;
  productName: string;
  saleOption: string;
  chinaOption: string;
  supplierLink: string;
  quantity: number;
  unitPriceCny: number;
  freightGroupId: string;
  domesticChinaFreightCny: number;
  orderNumber: string;
  note: string;
};

export type InternalChinaPurchaseDraft = {
  draftId: string;
  status: InternalChinaPurchaseDraftStatus;
  exchangeRateKrwPerCny: number;
  internalOrderCostMultiplier: number;
  lineCount: number;
  totalQuantity: number;
  createdFrom: "FAST_PURCHASE_RESERVED";
  sourceUpdatedAt: string;
  savedAt: string | null;
  metadataWarnings: string[];
  lines: InternalChinaPurchaseDraftLine[];
  externalOrderExecuted: false;
};

export type InternalChinaPurchaseDraftInput = {
  // Kept only so an older browser payload remains backward compatible. The
  // operator can no longer change the internal KRW/CNY basis from this page.
  exchangeRateKrwPerCny?: unknown;
  lines?: Array<{
    barcode?: unknown;
    saleOption?: unknown;
    chinaOption?: unknown;
    supplierLink?: unknown;
    quantity?: unknown;
    unitPriceCny?: unknown;
    freightGroupId?: unknown;
    domesticChinaFreightCny?: unknown;
    orderNumber?: unknown;
    note?: unknown;
  }>;
};

type StoredPrepRow = {
  result_snapshot?: unknown;
  started_at?: unknown;
  updated_at?: unknown;
};

type EditableLine = Pick<
  InternalChinaPurchaseDraftLine,
  | "chinaOption"
  | "supplierLink"
  | "unitPriceCny"
  | "freightGroupId"
  | "domesticChinaFreightCny"
  | "orderNumber"
  | "note"
>;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizeBarcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function decimal(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function validDraftId(value: unknown) {
  const draftId = text(value);
  if (!DRAFT_ID.test(draftId)) {
    throw new Error("INTERNAL_CHINA_DRAFT_ID_INVALID");
  }
  return draftId;
}

function normalizedModelNo(value: unknown, fallback: string) {
  const candidate = text(value);
  return candidate && !/^LEGACY-/i.test(candidate) ? candidate : fallback;
}

function normalizeSupplierLink(value: unknown) {
  const candidate = text(value);
  if (!candidate) return "";
  if (candidate.length > 4000) {
    throw new Error("중국 주문링크는 4,000자 이하로 입력하세요.");
  }
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("INVALID_PROTOCOL");
    }
    return url.toString();
  } catch {
    throw new Error("중국 주문링크는 올바른 http/https 주소여야 합니다.");
  }
}

function prepSourceEventId(draftId: string) {
  return `internal-china-purchase-prep:${draftId}`;
}

function correlationId(draftId: string) {
  return `internal-china-purchase:${draftId}`;
}

function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

async function currentCommitments(draftId: string) {
  const ledger = await loadChinaOrderLedger();
  if (ledger.error) {
    throw new Error(`CHINA_ORDER_LEDGER_UNAVAILABLE:${ledger.error}`);
  }
  const commitments = ledger.commitments
    .filter(
      (row) =>
        row.sourceSystem === SOURCE_SYSTEM &&
        row.sourceRunId === draftId &&
        row.openQuantity > 0,
    )
    .sort((left, right) => left.barcode.localeCompare(right.barcode));
  if (!commitments.length) {
    const progressed = ledger.commitments
      .filter(
        (row) =>
          row.sourceSystem === SOURCE_SYSTEM && row.sourceRunId === draftId,
      )
      .sort((left, right) => left.barcode.localeCompare(right.barcode));
    if (progressed.length) return progressed;
    throw new Error("INTERNAL_CHINA_DRAFT_NOT_FOUND");
  }
  return commitments;
}

async function readSavedPrep(draftId: string) {
  const admin = await createSupabaseAdminClient();
  if (!admin) return null;
  const result = await admin
    .from("commerce_operation_runs")
    .select("result_snapshot,started_at,updated_at")
    .eq("operation_type", INTERNAL_CHINA_PURCHASE_PREP_OPERATION_TYPE)
    .eq("source_event_id", prepSourceEventId(draftId))
    .maybeSingle();
  if (result.error || !result.data || typeof result.data !== "object") return null;
  const row = result.data as StoredPrepRow;
  const resultSnapshot = object(row.result_snapshot);
  const snapshot = object(resultSnapshot.snapshot);
  if (text(snapshot.draftId) !== draftId || !Array.isArray(snapshot.lines)) {
    return null;
  }
  return {
    snapshot,
    savedAt:
      text(row.updated_at) ||
      text(row.started_at) ||
      text(snapshot.savedAt) ||
      null,
  };
}

async function buildMetadataByBarcode(barcodes: string[]) {
  const warnings: string[] = [];
  let planning: Awaited<ReturnType<typeof loadProductPlanningSnapshot>> | null =
    null;
  let tracker: Awaited<
    ReturnType<typeof loadProductLaunchPurchaseMetadataByBarcode>
  > | null = null;

  try {
    planning = await loadProductPlanningSnapshot();
  } catch (error) {
    warnings.push(
      `Product Master 표시정보를 일부 불러오지 못했습니다: ${
        error instanceof Error ? error.message : "UNKNOWN"
      }`,
    );
  }
  try {
    tracker = await loadProductLaunchPurchaseMetadataByBarcode();
    if (tracker.error) {
      warnings.push(`상품출시 구매정보 경고: ${tracker.error}`);
    }
  } catch (error) {
    warnings.push(
      `상품출시 구매정보를 불러오지 못했습니다: ${
        error instanceof Error ? error.message : "UNKNOWN"
      }`,
    );
  }

  const planningByBarcode = new Map(
    (planning?.products ?? [])
      .filter((row) => row.skuActive !== false)
      .map((row) => [normalizeBarcode(row.barcode), row] as const),
  );

  const goodsKeysByBarcode = new Map<string, string[]>();
  for (const barcode of barcodes) {
    const profile = planningByBarcode.get(barcode);
    const goodsKeys = [
      ...new Set(
        (profile?.listings ?? [])
          .filter((listing) => listing.active !== false)
          .map((listing) => text(listing.goodsKey))
          .filter((goodsKey) => /^\d+$/.test(goodsKey)),
      ),
    ].sort((left, right) => Number(left) - Number(right));
    goodsKeysByBarcode.set(barcode, goodsKeys);
  }

  const liveByBarcode = new Map<
    string,
    { modelNo: string | null; modelName: string | null }
  >();
  const allGoodsKeys = [...new Set([...goodsKeysByBarcode.values()].flat())];
  if (allGoodsKeys.length) {
    try {
      const live = await loadShoplingCurrentModelSnapshot(allGoodsKeys);
      const byGoodsKey = new Map(
        live.rows.map((row) => [row.goodsKey, row] as const),
      );
      for (const [barcode, goodsKeys] of goodsKeysByBarcode) {
        const sourceRows = goodsKeys
          .map((goodsKey) => byGoodsKey.get(goodsKey))
          .filter((row): row is NonNullable<typeof row> => Boolean(row));
        const modelNos = [
          ...new Set(
            sourceRows
              .filter((row) => row.state === "EXACT_AAA")
              .flatMap((row) => row.modelNos.map(text).filter(Boolean)),
          ),
        ];
        const modelNames = [
          ...new Set(
            sourceRows.flatMap((row) =>
              row.modelNames.map(text).filter(Boolean),
            ),
          ),
        ];
        liveByBarcode.set(barcode, {
          modelNo: modelNos.length === 1 ? modelNos[0] : null,
          modelName: modelNames.length ? modelNames.join(" / ") : null,
        });
      }
    } catch (error) {
      warnings.push(
        `Shopling 모델명 표시정보를 불러오지 못했습니다: ${
          error instanceof Error ? error.message : "UNKNOWN"
        }`,
      );
    }
  }

  return { planningByBarcode, tracker, liveByBarcode, warnings };
}

async function buildBaseDraft(
  draftIdInput: unknown,
): Promise<InternalChinaPurchaseDraft> {
  const draftId = validDraftId(draftIdInput);
  const commitments = await currentCommitments(draftId);
  const barcodes = commitments.map((row) => row.barcode);
  const { planningByBarcode, tracker, liveByBarcode, warnings } =
    await buildMetadataByBarcode(barcodes);

  const lines = commitments.map(
    (commitment): InternalChinaPurchaseDraftLine => {
      const barcode = commitment.barcode;
      const profile = planningByBarcode.get(barcode);
      const trackerRow = tracker?.byBarcode.get(barcode);
      const live = liveByBarcode.get(barcode);
      const trackerUsable = trackerRow && !trackerRow.conflict ? trackerRow : null;
      const sourcePayload = object(commitment.latestPayload);
      const modelNo =
        normalizedModelNo(trackerUsable?.modelNumber, "") ||
        normalizedModelNo(profile?.modelNo, "") ||
        normalizedModelNo(sourcePayload.modelNo, "") ||
        normalizedModelNo(live?.modelNo, barcode);
      const modelName =
        text(trackerUsable?.productName) ||
        text(profile?.productName) ||
        text(sourcePayload.productName) ||
        text(live?.modelName) ||
        barcode;
      return {
        barcode,
        modelNo,
        modelName,
        productName: modelName,
        saleOption:
          text(trackerUsable?.saleOption) ||
          text(profile?.optionName) ||
          text(sourcePayload.saleOption),
        chinaOption:
          text(trackerUsable?.chinaOption) || text(sourcePayload.chinaOption),
        supplierLink:
          text(trackerUsable?.supplierLink) || text(sourcePayload.supplierLink),
        quantity: Math.min(
          MANUAL_QUANTITY_MAX,
          commitment.openQuantity || commitment.committedQuantity,
        ),
        unitPriceCny: Math.min(1_000_000, decimal(sourcePayload.unitPriceCny)),
        freightGroupId: "",
        domesticChinaFreightCny: 0,
        orderNumber: "",
        note: "",
      };
    },
  );

  const ordered = commitments.every(
    (row) =>
      row.orderedQuantity > 0 ||
      ["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(row.status),
  );
  const sourceUpdatedAt = commitments.reduce(
    (latest, row) =>
      Date.parse(row.updatedAt) > Date.parse(latest) ? row.updatedAt : latest,
    commitments[0]?.updatedAt ?? new Date(0).toISOString(),
  );

  return {
    draftId,
    status: ordered ? "ORDERED" : "DRAFT",
    exchangeRateKrwPerCny: INTERNAL_CHINA_FIXED_KRW_PER_CNY,
    internalOrderCostMultiplier: INTERNAL_CHINA_ORDER_COST_MULTIPLIER,
    lineCount: lines.length,
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    createdFrom: "FAST_PURCHASE_RESERVED",
    sourceUpdatedAt,
    savedAt: null,
    metadataWarnings: warnings,
    lines,
    externalOrderExecuted: false,
  };
}

function editableFrom(value: unknown): Partial<EditableLine> {
  const row = object(value);
  const output: Partial<EditableLine> = {};
  if ("chinaOption" in row) {
    output.chinaOption = text(row.chinaOption).slice(0, 240);
  }
  if ("supplierLink" in row) {
    output.supplierLink = normalizeSupplierLink(row.supplierLink);
  }
  if ("unitPriceCny" in row) {
    output.unitPriceCny = Math.min(1_000_000, decimal(row.unitPriceCny));
  }
  if ("freightGroupId" in row) {
    output.freightGroupId = text(row.freightGroupId).slice(0, 100);
  }
  if ("domesticChinaFreightCny" in row) {
    output.domesticChinaFreightCny = Math.min(
      1_000_000,
      decimal(row.domesticChinaFreightCny),
    );
  }
  if ("orderNumber" in row) {
    output.orderNumber = text(row.orderNumber).slice(0, 160);
  }
  if ("note" in row) output.note = text(row.note).slice(0, 300);
  return output;
}

function mergeSavedLine(
  baseLine: InternalChinaPurchaseDraftLine,
  savedValue: unknown,
): InternalChinaPurchaseDraftLine {
  const saved = editableFrom(savedValue);
  return {
    ...baseLine,
    ...saved,
    // B-code -> 판매옵션은 상품출시/Product Master의 기준값이며 이 주문 화면에서
    // 수정하지 않는다. 중국옵션과 링크도 tracker에 값이 생기면 tracker가 우선한다.
    saleOption: baseLine.saleOption,
    chinaOption: baseLine.chinaOption || text(saved.chinaOption),
    supplierLink: baseLine.supplierLink || text(saved.supplierLink),
  };
}

function mergeSnapshot(
  base: InternalChinaPurchaseDraft,
  snapshot: Record<string, unknown>,
  savedAt: string | null,
) {
  const savedLines = Array.isArray(snapshot.lines) ? snapshot.lines : [];
  const byBarcode = new Map(
    savedLines
      .map((value) => object(value))
      .map((row) => [normalizeBarcode(row.barcode), row] as const)
      .filter(([barcode]) => BARCODE.test(barcode)),
  );
  const lines = base.lines.map((line) => {
    const saved = byBarcode.get(line.barcode);
    return saved ? mergeSavedLine(line, saved) : line;
  });
  return {
    ...base,
    // Internal conversion/cost policy is system-owned, not operator editable.
    exchangeRateKrwPerCny: INTERNAL_CHINA_FIXED_KRW_PER_CNY,
    internalOrderCostMultiplier: INTERNAL_CHINA_ORDER_COST_MULTIPLIER,
    savedAt,
    lines,
  } satisfies InternalChinaPurchaseDraft;
}

export async function loadInternalChinaPurchaseDraft(draftIdInput: unknown) {
  const base = await buildBaseDraft(draftIdInput);
  const saved = await readSavedPrep(base.draftId);
  return saved ? mergeSnapshot(base, saved.snapshot, saved.savedAt) : base;
}

function mergeInput(
  base: InternalChinaPurchaseDraft,
  input: InternalChinaPurchaseDraftInput,
) {
  const sourceLines = Array.isArray(input.lines) ? input.lines : [];
  const byBarcode = new Map(
    sourceLines
      .map((value) => [normalizeBarcode(value.barcode), value] as const)
      .filter(([barcode]) => BARCODE.test(barcode)),
  );
  const lines = base.lines.map((line) => {
    const incoming = byBarcode.get(line.barcode);
    if (!incoming) return line;
    const requestedQuantity = integer(incoming.quantity);
    if (requestedQuantity && requestedQuantity !== line.quantity) {
      throw new Error(`INTERNAL_CHINA_QUANTITY_LOCKED:${line.barcode}`);
    }
    return {
      ...line,
      ...editableFrom(incoming),
      // The sale option is always resolved from the B-code source metadata.
      saleOption: line.saleOption,
    };
  });
  return {
    ...base,
    exchangeRateKrwPerCny: INTERNAL_CHINA_FIXED_KRW_PER_CNY,
    internalOrderCostMultiplier: INTERNAL_CHINA_ORDER_COST_MULTIPLIER,
    lines,
  } satisfies InternalChinaPurchaseDraft;
}

async function storePrepSnapshot(snapshot: InternalChinaPurchaseDraft) {
  const { baseUrl, secret } = supabaseConnection();
  const now = new Date().toISOString();
  const storedSnapshot = { ...snapshot, savedAt: now };
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?on_conflict=source_event_id&select=source_event_id,updated_at`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify([
        {
          operation_type: INTERNAL_CHINA_PURCHASE_PREP_OPERATION_TYPE,
          status: "SUCCEEDED",
          source: PREP_SOURCE,
          source_event_id: prepSourceEventId(snapshot.draftId),
          correlation_id: correlationId(snapshot.draftId),
          actor_type: "OPS_OPERATOR",
          input_snapshot: {
            draftId: snapshot.draftId,
            exchangeRateKrwPerCny: snapshot.exchangeRateKrwPerCny,
            internalOrderCostMultiplier: snapshot.internalOrderCostMultiplier,
            lineCount: snapshot.lineCount,
            totalQuantity: snapshot.totalQuantity,
          },
          result_snapshot: {
            snapshot: storedSnapshot,
            externalOrderExecuted: false,
          },
          error_message: null,
          started_at: now,
          finished_at: now,
          updated_at: now,
        },
      ]),
      cache: "no-store",
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `INTERNAL_CHINA_PREP_STORE_FAILED:${response.status}:${body.slice(0, 400)}`,
    );
  }
  return storedSnapshot;
}

export async function saveInternalChinaPurchaseDraft(
  draftIdInput: unknown,
  input: InternalChinaPurchaseDraftInput,
) {
  const current = await loadInternalChinaPurchaseDraft(draftIdInput);
  if (current.status !== "DRAFT") {
    throw new Error("INTERNAL_CHINA_DRAFT_ALREADY_ORDERED");
  }
  const next = mergeInput(current, input);
  const stored = await storePrepSnapshot(next);
  return { ...next, savedAt: stored.savedAt };
}

function blockingOrderIssues(draft: InternalChinaPurchaseDraft) {
  const issues: string[] = [];
  for (const line of draft.lines) {
    if (line.unitPriceCny <= 0) issues.push(`${line.barcode} 위안단가`);
    if (!line.supplierLink) issues.push(`${line.barcode} 1688 링크`);
  }
  return issues;
}

function orderedSourceEventId(draftId: string, barcode: string) {
  const digest = createHash("sha256")
    .update(`${draftId}:${barcode}:ordered-v1`)
    .digest("hex")
    .slice(0, 16);
  return `${draftId}:${barcode}:ordered:${digest}`;
}

async function storeOrderedEvents(draft: InternalChinaPurchaseDraft) {
  const commitments = await currentCommitments(draft.draftId);
  const commitmentByBarcode = new Map(
    commitments.map((row) => [row.barcode, row] as const),
  );
  const occurredAt = new Date().toISOString();
  const operations = draft.lines.map((line) => {
    const commitment = commitmentByBarcode.get(line.barcode);
    if (!commitment) {
      throw new Error(`INTERNAL_CHINA_COMMITMENT_MISSING:${line.barcode}`);
    }
    const event = normalizeChinaOrderCommitmentEvent({
      sourceSystem: commitment.sourceSystem,
      sourceLineId: commitment.sourceLineId,
      sourceRunId: draft.draftId,
      sourceEventId: orderedSourceEventId(draft.draftId, line.barcode),
      barcode: line.barcode,
      status: "ORDERED",
      orderedQuantity: line.quantity,
      occurredAt,
      note: "Ops Center 내부 중국 발주초안 · 운영자가 실제 1688 주문 완료 후 기록",
      payload: {
        modelNo: line.modelNo,
        modelName: line.modelName,
        productName: line.productName,
        saleOption: line.saleOption,
        chinaOption: line.chinaOption,
        supplierLink: line.supplierLink,
        unitPriceCny: line.unitPriceCny,
        freightGroupId: line.freightGroupId,
        domesticChinaFreightCny: line.domesticChinaFreightCny,
        exchangeRateKrwPerCny: draft.exchangeRateKrwPerCny,
        internalOrderCostMultiplier: draft.internalOrderCostMultiplier,
        orderNumber: line.orderNumber,
        operatorNote: line.note,
        externalOrderExecuted: false,
      },
    });
    return {
      operation_type: CHINA_ORDER_EVENT_OPERATION_TYPE,
      status: "SUCCEEDED",
      source: PREP_SOURCE,
      source_event_id: `china-order:${encodeURIComponent(event.sourceSystem)}:${encodeURIComponent(event.sourceEventId)}`,
      correlation_id: `china-order-line:${encodeURIComponent(event.sourceSystem)}:${encodeURIComponent(event.sourceLineId)}`,
      actor_type: "OPS_OPERATOR",
      input_snapshot: event,
      result_snapshot: {
        accepted: true,
        orderedRecorded: true,
        externalOrderExecuted: false,
        draftId: draft.draftId,
        barcode: line.barcode,
        orderedQuantity: line.quantity,
      },
      error_message: null,
      started_at: occurredAt,
      finished_at: occurredAt,
      updated_at: occurredAt,
    };
  });

  const { baseUrl, secret } = supabaseConnection();
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?on_conflict=source_event_id&select=source_event_id`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify(operations),
      cache: "no-store",
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `INTERNAL_CHINA_ORDER_RECORD_FAILED:${response.status}:${body.slice(0, 400)}`,
    );
  }
  const inserted = body ? (JSON.parse(body) as unknown) : [];
  return { insertedCount: Array.isArray(inserted) ? inserted.length : 0 };
}

export async function markInternalChinaPurchaseDraftOrdered(
  draftIdInput: unknown,
  input: InternalChinaPurchaseDraftInput,
) {
  let draft = await loadInternalChinaPurchaseDraft(draftIdInput);
  if (draft.status === "ORDERED") {
    return { draft, duplicate: true, externalOrderExecuted: false as const };
  }
  draft = mergeInput(draft, input);
  const issues = blockingOrderIssues(draft);
  if (issues.length) {
    throw new Error(
      `INTERNAL_CHINA_ORDER_REQUIRED:${issues.slice(0, 12).join(", ")}`,
    );
  }
  await storePrepSnapshot(draft);
  const stored = await storeOrderedEvents(draft);
  const orderedDraft: InternalChinaPurchaseDraft = {
    ...draft,
    status: "ORDERED",
    savedAt: new Date().toISOString(),
  };
  await storePrepSnapshot(orderedDraft);
  return {
    draft: orderedDraft,
    duplicate: stored.insertedCount === 0,
    externalOrderExecuted: false as const,
  };
}
