import {
  CHINA_ORDER_EVENT_OPERATION_TYPE,
  loadChinaOrderLedger,
  normalizeChinaOrderCommitmentEvent,
} from "@/lib/chinaOrderLedger";
import { loadInternalChinaPurchaseDraft } from "@/lib/internalChinaPurchaseDraft";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { loadProductLaunchPurchaseMetadataByBarcode } from "@/lib/productLaunchPurchaseMetadata";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import { PURCHASE_DRAFT_MANUAL_ADDITION_PROVENANCE_VERSION } from "@/lib/purchaseCycleDraftRegenerationCore";

const SOURCE_SYSTEM = "fast-purchase-mvp";
const MANUAL_SOURCE = "ops-center-internal-china-order-manual-add";
const BARCODE = /^[A-Z]{3}\d+-\d+$/;
const MANUAL_QUANTITY_MAX = 9_999;
const RESULT_LIMIT_PER_TERM = 30;
const RESULT_LIMIT_MAX = 200;
const SEARCH_TERM_LIMIT = 50;

export type InternalChinaManualDraftCandidate = {
  barcode: string;
  modelNo: string;
  productName: string;
  optionName: string;
  inDraft: boolean;
  currentDraftQuantity: number;
  otherOpenQuantity: number;
};

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

function joinedLabels(values: unknown[]) {
  return [...new Set(values.map(text).filter(Boolean))].join(" / ");
}

export function parseManualDraftSearchTerms(value: unknown) {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of text(value).split(/[,;\n\r]+/)) {
    const term = text(raw);
    if (term.length < 2) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= SEARCH_TERM_LIMIT) break;
  }
  return terms;
}

function normalizeRequestId(value: unknown) {
  const requestId = text(value).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  if (requestId.length < 8) throw new Error("INTERNAL_CHINA_MANUAL_ADD_REQUEST_ID_INVALID");
  return requestId;
}

function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

export function calculateManualDraftTargetQuantity(
  currentQuantityInput: unknown,
  addQuantityInput: unknown,
) {
  const currentQuantity = integer(currentQuantityInput);
  const addQuantity = integer(addQuantityInput);
  if (addQuantity < 1 || addQuantity > MANUAL_QUANTITY_MAX) {
    throw new Error("INTERNAL_CHINA_MANUAL_ADD_QUANTITY_INVALID");
  }
  const targetQuantity = currentQuantity + addQuantity;
  if (targetQuantity > MANUAL_QUANTITY_MAX) {
    throw new Error("INTERNAL_CHINA_MANUAL_ADD_QUANTITY_EXCEEDED");
  }
  return targetQuantity;
}

function candidateScore(
  candidate: Pick<
    InternalChinaManualDraftCandidate,
    "barcode" | "modelNo" | "productName" | "optionName"
  >,
  queryInput: unknown,
) {
  const query = text(queryInput).toLowerCase();
  const barcode = candidate.barcode.toLowerCase();
  const modelNo = candidate.modelNo.toLowerCase();
  const productName = candidate.productName.toLowerCase();
  const optionName = candidate.optionName.toLowerCase();
  if (barcode === query) return 0;
  if (modelNo === query) return 1;
  if (barcode.startsWith(query)) return 2;
  if (modelNo.startsWith(query)) return 3;
  if (productName.startsWith(query)) return 4;
  if (optionName.startsWith(query)) return 5;
  if (barcode.includes(query)) return 6;
  if (modelNo.includes(query)) return 7;
  if (productName.includes(query)) return 8;
  if (optionName.includes(query)) return 9;
  return 100;
}

function bestSearchMatch(
  candidate: Pick<
    InternalChinaManualDraftCandidate,
    "barcode" | "modelNo" | "productName" | "optionName"
  >,
  terms: string[],
) {
  let termIndex = Number.POSITIVE_INFINITY;
  let score = 100;
  for (let index = 0; index < terms.length; index += 1) {
    const currentScore = candidateScore(candidate, terms[index]);
    if (currentScore >= 100) continue;
    if (index < termIndex || (index === termIndex && currentScore < score)) {
      termIndex = index;
      score = currentScore;
    }
  }
  return { termIndex, score };
}

export async function searchInternalChinaManualDraftCandidates(
  draftIdInput: unknown,
  queryInput: unknown,
): Promise<InternalChinaManualDraftCandidate[]> {
  const terms = parseManualDraftSearchTerms(queryInput);
  if (!terms.length) return [];

  const [draft, planning, ledger, tracker] = await Promise.all([
    loadInternalChinaPurchaseDraft(draftIdInput),
    loadProductPlanningSnapshot(),
    loadChinaOrderLedger(),
    loadProductLaunchPurchaseMetadataByBarcode(),
  ]);
  if (draft.status !== "DRAFT") {
    throw new Error("INTERNAL_CHINA_DRAFT_ALREADY_ORDERED");
  }
  if (ledger.error) {
    throw new Error(`CHINA_ORDER_LEDGER_UNAVAILABLE:${ledger.error}`);
  }

  const currentDraftByBarcode = new Map(
    draft.lines.map((line) => [normalizeBarcode(line.barcode), line] as const),
  );
  const otherOpenByBarcode = new Map<string, number>();
  for (const commitment of ledger.commitments) {
    if (commitment.sourceRunId === draft.draftId || commitment.openQuantity <= 0) {
      continue;
    }
    const barcode = normalizeBarcode(commitment.barcode);
    otherOpenByBarcode.set(
      barcode,
      (otherOpenByBarcode.get(barcode) ?? 0) + commitment.openQuantity,
    );
  }

  const matched: Array<{
    candidate: InternalChinaManualDraftCandidate;
    termIndex: number;
    score: number;
  }> = [];
  const seenBarcodes = new Set<string>();

  for (const product of planning.products) {
    if (product.skuActive === false) continue;
    const barcode = normalizeBarcode(product.barcode);
    if (!BARCODE.test(barcode) || seenBarcodes.has(barcode)) continue;
    const current = currentDraftByBarcode.get(barcode);
    const trackerRow = tracker.byBarcode.get(barcode);
    const candidate: InternalChinaManualDraftCandidate = {
      barcode,
      modelNo: joinedLabels([trackerRow?.modelNumber, product.modelNo]),
      productName:
        joinedLabels([trackerRow?.productName, product.productName]) || barcode,
      optionName: joinedLabels([trackerRow?.saleOption, product.optionName]),
      inDraft: Boolean(current),
      currentDraftQuantity: current?.quantity ?? 0,
      otherOpenQuantity: otherOpenByBarcode.get(barcode) ?? 0,
    };
    const match = bestSearchMatch(candidate, terms);
    if (!Number.isFinite(match.termIndex) || match.score >= 100) continue;
    seenBarcodes.add(barcode);
    matched.push({ candidate, ...match });
  }

  const resultLimit = Math.min(
    RESULT_LIMIT_MAX,
    Math.max(RESULT_LIMIT_PER_TERM, terms.length * RESULT_LIMIT_PER_TERM),
  );

  return matched
    .sort(
      (left, right) =>
        left.termIndex - right.termIndex ||
        left.score - right.score ||
        left.candidate.modelNo.localeCompare(right.candidate.modelNo) ||
        left.candidate.barcode.localeCompare(right.candidate.barcode),
    )
    .slice(0, resultLimit)
    .map((row) => row.candidate);
}

export async function addInternalChinaManualDraftLine(input: {
  draftId: unknown;
  barcode: unknown;
  addQuantity: unknown;
  requestId: unknown;
}) {
  const draft = await loadInternalChinaPurchaseDraft(input.draftId);
  if (draft.status !== "DRAFT") {
    throw new Error("INTERNAL_CHINA_DRAFT_ALREADY_ORDERED");
  }

  const barcode = normalizeBarcode(input.barcode);
  if (!BARCODE.test(barcode)) {
    throw new Error(`INTERNAL_CHINA_MANUAL_ADD_BARCODE_INVALID:${barcode}`);
  }
  const requestId = normalizeRequestId(input.requestId);

  const [planning, ledger] = await Promise.all([
    loadProductPlanningSnapshot(),
    loadChinaOrderLedger(),
  ]);
  if (ledger.error) {
    throw new Error(`CHINA_ORDER_LEDGER_UNAVAILABLE:${ledger.error}`);
  }

  const product = planning.products.find(
    (row) => row.skuActive !== false && normalizeBarcode(row.barcode) === barcode,
  );
  if (!product) {
    throw new Error(`INTERNAL_CHINA_MANUAL_ADD_BARCODE_NOT_ACTIVE:${barcode}`);
  }

  const draftCommitments = ledger.commitments.filter(
    (row) => row.sourceSystem === SOURCE_SYSTEM && row.sourceRunId === draft.draftId,
  );
  if (
    draftCommitments.some(
      (row) =>
        row.orderedQuantity > 0 ||
        ["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(row.status),
    )
  ) {
    throw new Error("INTERNAL_CHINA_MANUAL_ADD_AFTER_ORDER_STARTED");
  }

  const current = draftCommitments.find(
    (row) => normalizeBarcode(row.barcode) === barcode,
  );
  if (current && ["CANCELLED", "FAILED"].includes(current.status)) {
    throw new Error(`INTERNAL_CHINA_MANUAL_ADD_CANCELLED_LINE:${barcode}`);
  }

  const currentQuantity = current?.requestedQuantity ?? 0;
  const targetQuantity = calculateManualDraftTargetQuantity(
    currentQuantity,
    input.addQuantity,
  );
  const occurredAt = new Date().toISOString();
  const sourceLineId = current?.sourceLineId || `${draft.draftId}:${barcode}`;
  const event = normalizeChinaOrderCommitmentEvent({
    sourceSystem: SOURCE_SYSTEM,
    sourceLineId,
    sourceRunId: draft.draftId,
    sourceEventId: `${draft.draftId}:${barcode}:manual-add:${requestId}`,
    barcode,
    status: "RESERVED",
    requestedQuantity: targetQuantity,
    occurredAt,
    note: `월간 최종 Draft 운영자 수동 추가 · +${integer(input.addQuantity)}개`,
    payload: {
      manualAddition: true,
      manualAdditionProvenanceVersion:
        PURCHASE_DRAFT_MANUAL_ADDITION_PROVENANCE_VERSION,
      modelNo: text(product.modelNo),
      productName: text(product.productName),
      optionName: text(product.optionName),
      previousRequestedQuantity: currentQuantity,
      addedQuantity: integer(input.addQuantity),
      targetRequestedQuantity: targetQuantity,
      externalOrderExecuted: false,
    },
  });

  const { baseUrl, secret } = supabaseConnection();
  const operationSourceEventId = `china-order:${encodeURIComponent(
    event.sourceSystem,
  )}:${encodeURIComponent(event.sourceEventId)}`;
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?on_conflict=source_event_id&select=source_event_id`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify([
        {
          operation_type: CHINA_ORDER_EVENT_OPERATION_TYPE,
          status: "SUCCEEDED",
          source: MANUAL_SOURCE,
          source_event_id: operationSourceEventId,
          correlation_id: `china-order-line:${encodeURIComponent(
            event.sourceSystem,
          )}:${encodeURIComponent(event.sourceLineId)}`,
          actor_type: "OPS_OPERATOR",
          input_snapshot: event,
          result_snapshot: {
            accepted: true,
            internalDraft: true,
            manualAddition: true,
            externalOrderExecuted: false,
            draftId: draft.draftId,
            barcode,
            previousRequestedQuantity: currentQuantity,
            addedQuantity: integer(input.addQuantity),
            targetRequestedQuantity: targetQuantity,
          },
          error_message: null,
          started_at: occurredAt,
          finished_at: occurredAt,
          updated_at: occurredAt,
        },
      ]),
      cache: "no-store",
    },
  );
  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(
      `INTERNAL_CHINA_MANUAL_ADD_STORE_FAILED:${response.status}:${responseBody.slice(0, 300)}`,
    );
  }

  const inserted = responseBody ? (JSON.parse(responseBody) as unknown) : [];
  const duplicate = Array.isArray(inserted) && inserted.length === 0;
  const updatedDraft = await loadInternalChinaPurchaseDraft(draft.draftId);
  const updatedLine = updatedDraft.lines.find(
    (line) => normalizeBarcode(line.barcode) === barcode,
  );

  return {
    draft: updatedDraft,
    line: updatedLine ?? null,
    duplicate,
    addedQuantity: integer(input.addQuantity),
    targetQuantity: updatedLine?.quantity ?? targetQuantity,
    otherOpenQuantity: ledger.commitments
      .filter(
        (row) =>
          row.sourceRunId !== draft.draftId &&
          normalizeBarcode(row.barcode) === barcode &&
          row.openQuantity > 0,
      )
      .reduce((sum, row) => sum + row.openQuantity, 0),
    externalOrderExecuted: false as const,
  };
}
