import { createHash } from "node:crypto";
import {
  OCTOBER_2026_SOURCE_ORDER_PURCHASE_COST_EVIDENCE,
  OCTOBER_2026_SOURCE_WORKBOOK,
  OCTOBER_2026_UNRESOLVED_LEGACY_COST_BARCODES,
  type SourceOrderPurchaseCostEvidenceSeed,
} from "@/data/october2026SourceOrderPurchaseCostEvidence";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import type { ProductPlanningSnapshot } from "@/lib/shopling/shoplingLiveAggregation";

const DEFAULT_PRODUCT_MASTER_URL =
  "https://commerce-os-product-master.vercel.app";
const SOURCE_BATCH_ID = "october-2026-source-order-purchase-cost-v1";
const SHA256 = /^sha256:[a-f0-9]{64}$/;

type PlanningSnapshot = ProductPlanningSnapshot & {
  contentFingerprint: string;
};

export type SourceOrderPurchaseCostEvidenceInput = {
  skuId: string;
  barcode: string;
  modelNo: string;
  optionName: string;
  evidenceClass: "SOURCE_ORDER_VERIFIED_COST_EVIDENCE";
  unitCostKrw: number;
  costDate: string;
  sourceSystem: string;
  sourceReference: string;
  sourceSubreference: string;
  sourceRowKey: string;
  costBasis: string;
  identityEvidence: string;
  confidence: "A";
};

export type SourceOrderPurchaseCostEvidencePreview = {
  generatedAt: string;
  state: "READY";
  message: string;
  sourceBatchId: string;
  sourceWorkbookId: string;
  sourceWorkbookTitle: string;
  sourceWorkbookUrl: string;
  planningContentFingerprint: string;
  importFingerprint: string;
  sourceRowCount: 23;
  resolvedRowCount: 23;
  unresolvedLegacyBarcodes: readonly string[];
  purchaseUseAllowed: true;
  priceUseAllowed: false;
  confirmedReceiptUseAllowed: false;
  inventoryWriteAllowed: false;
  actualPurchaseEnabled: false;
  rows: SourceOrderPurchaseCostEvidenceInput[];
};

type ImportResponse = {
  ok?: boolean;
  sourceBatchId?: string;
  verifiedRowCount?: number;
  insertedRowCount?: number;
  idempotentRowCount?: number;
  purchaseUseAllowed?: boolean;
  priceUseAllowed?: boolean;
  confirmedReceiptUseAllowed?: boolean;
  inventoryWriteAllowed?: boolean;
  error?: string;
  message?: string;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function barcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function modelNo(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function catalogOptionLabel(value: unknown) {
  return text(value) || "단품";
}

function fingerprint(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

function productMasterConnection() {
  const secret = process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim();
  if (!secret) throw new Error("PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED");
  const baseUrl = (
    process.env.PRODUCT_MASTER_BASE_URL?.trim() ||
    DEFAULT_PRODUCT_MASTER_URL
  ).replace(/\/$/, "");
  if (!/^https:\/\//.test(baseUrl)) {
    throw new Error("PRODUCT_MASTER_BASE_URL_INVALID");
  }
  return { baseUrl, secret };
}

function sourceRowKey(seed: SourceOrderPurchaseCostEvidenceSeed) {
  return `${seed.sourceSheet}!row:${seed.sourceRowNumber}`;
}

function evidenceInput(
  seed: SourceOrderPurchaseCostEvidenceSeed,
  product: ProductPlanningSnapshot["products"][number],
): SourceOrderPurchaseCostEvidenceInput {
  const optionName = text(product.optionName);
  const mapping = seed.mappingNote
    ? ` 옵션 교차검증: ${seed.mappingNote}.`
    : "";
  return {
    skuId: text(product.skuId),
    barcode: seed.barcode,
    modelNo: seed.modelNo,
    optionName,
    evidenceClass: seed.evidenceClass,
    unitCostKrw: seed.unitCostKrw,
    costDate: seed.costDate,
    sourceSystem: "GOOGLE_SHEETS_CHINA_ORDER_LEDGER",
    sourceReference: OCTOBER_2026_SOURCE_WORKBOOK.url,
    sourceSubreference: `${seed.sourceSheet} · row ${seed.sourceRowNumber} · ${seed.sourceStatus}`,
    sourceRowKey: sourceRowKey(seed),
    costBasis: `${seed.sourceStatus} 행의 최종 단위원가(KRW). 소수 원 단위는 과소계상 방지를 위해 올림.`,
    identityEvidence:
      `${OCTOBER_2026_SOURCE_WORKBOOK.title}의 ${seed.modelNo} ${seed.sourceProductName} ` +
      `${seed.sourceOptionName} 행과 Product Master ${seed.barcode} ` +
      `${catalogOptionLabel(optionName)} 활성 SKU를 모델·B코드·옵션으로 재검증.${mapping}`,
    confidence: seed.confidence,
  };
}

export function buildOctober2026SourceOrderCostEvidencePreview(
  snapshot: PlanningSnapshot,
): SourceOrderPurchaseCostEvidencePreview {
  if (!SHA256.test(snapshot.contentFingerprint)) {
    throw new Error("SOURCE_ORDER_COST_PLANNING_FINGERPRINT_INVALID");
  }
  const seeds: readonly SourceOrderPurchaseCostEvidenceSeed[] =
    OCTOBER_2026_SOURCE_ORDER_PURCHASE_COST_EVIDENCE;
  if (seeds.length !== 23) {
    throw new Error("SOURCE_ORDER_COST_EVIDENCE_COUNT_INVALID");
  }
  const duplicateBarcodes = new Set<string>();
  const seenBarcodes = new Set<string>();
  for (const seed of seeds) {
    const key = barcode(seed.barcode);
    if (seenBarcodes.has(key)) duplicateBarcodes.add(key);
    seenBarcodes.add(key);
  }
  if (duplicateBarcodes.size) {
    throw new Error("SOURCE_ORDER_COST_EVIDENCE_DUPLICATE_BARCODE");
  }
  if (
    OCTOBER_2026_UNRESOLVED_LEGACY_COST_BARCODES.some((value) =>
      seenBarcodes.has(barcode(value)),
    )
  ) {
    throw new Error("SOURCE_ORDER_COST_UNRESOLVED_LEGACY_INCLUDED");
  }

  const rows = seeds.map((seed) => {
    const matches = snapshot.products.filter(
      (product) =>
        product.skuActive !== false &&
        barcode(product.barcode) === seed.barcode,
    );
    if (matches.length !== 1) {
      throw new Error(
        `SOURCE_ORDER_COST_BARCODE_IDENTITY_CONFLICT:${seed.barcode}:${matches.length}`,
      );
    }
    const product = matches[0];
    if (!text(product.skuId)) {
      throw new Error(`SOURCE_ORDER_COST_SKU_ID_MISSING:${seed.barcode}`);
    }
    if (modelNo(product.modelNo) !== seed.modelNo) {
      throw new Error(
        `SOURCE_ORDER_COST_MODEL_IDENTITY_CONFLICT:${seed.barcode}:${modelNo(product.modelNo)}`,
      );
    }
    const actualOptionLabel = catalogOptionLabel(product.optionName);
    if (actualOptionLabel !== seed.expectedCatalogOptionLabel) {
      throw new Error(
        `SOURCE_ORDER_COST_OPTION_IDENTITY_CONFLICT:${seed.barcode}:${actualOptionLabel}`,
      );
    }
    if (
      text(seed.sourceOptionName) !== seed.expectedCatalogOptionLabel &&
      !text(seed.mappingNote)
    ) {
      throw new Error(`SOURCE_ORDER_COST_OPTION_MAPPING_MISSING:${seed.barcode}`);
    }
    return evidenceInput(seed, product);
  });

  const importFingerprint = fingerprint({
    sourceBatchId: SOURCE_BATCH_ID,
    planningContentFingerprint: snapshot.contentFingerprint,
    rows,
  });
  return {
    generatedAt: new Date().toISOString(),
    state: "READY",
    message:
      "중국 주문 원본과 Product Master의 모델·B코드·옵션이 모두 일치한 23건입니다. 구매원가 근거로만 수입할 수 있으며 미식별 레거시 5건은 계속 제외합니다.",
    sourceBatchId: SOURCE_BATCH_ID,
    sourceWorkbookId: OCTOBER_2026_SOURCE_WORKBOOK.id,
    sourceWorkbookTitle: OCTOBER_2026_SOURCE_WORKBOOK.title,
    sourceWorkbookUrl: OCTOBER_2026_SOURCE_WORKBOOK.url,
    planningContentFingerprint: snapshot.contentFingerprint,
    importFingerprint,
    sourceRowCount: 23,
    resolvedRowCount: 23,
    unresolvedLegacyBarcodes: [
      ...OCTOBER_2026_UNRESOLVED_LEGACY_COST_BARCODES,
    ],
    purchaseUseAllowed: true,
    priceUseAllowed: false,
    confirmedReceiptUseAllowed: false,
    inventoryWriteAllowed: false,
    actualPurchaseEnabled: false,
    rows,
  };
}

export async function loadOctober2026SourceOrderCostEvidencePreview() {
  const snapshot = await loadProductPlanningSnapshot();
  return buildOctober2026SourceOrderCostEvidencePreview(snapshot);
}

export async function importOctober2026SourceOrderCostEvidence(
  expectedImportFingerprint: unknown,
) {
  const expected = text(expectedImportFingerprint);
  if (!SHA256.test(expected)) {
    throw new Error("SOURCE_ORDER_COST_EXPECTED_FINGERPRINT_INVALID");
  }
  const preview = await loadOctober2026SourceOrderCostEvidencePreview();
  if (preview.importFingerprint !== expected) {
    throw new Error("SOURCE_ORDER_COST_PRECONDITION_CHANGED");
  }
  const { baseUrl, secret } = productMasterConnection();
  const response = await fetch(
    `${baseUrl}/api/integrations/purchase-cost-evidence`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-commerce-os-integration-secret": secret,
      },
      body: JSON.stringify({
        sourceBatchId: preview.sourceBatchId,
        rows: preview.rows,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    },
  );
  const body = (await response.json().catch(() => ({}))) as ImportResponse;
  if (!response.ok || body.ok !== true) {
    throw new Error(
      body.message ||
        body.error ||
        `SOURCE_ORDER_COST_IMPORT_FAILED:${response.status}`,
    );
  }
  if (
    body.sourceBatchId !== preview.sourceBatchId ||
    body.verifiedRowCount !== preview.rows.length ||
    Number(body.insertedRowCount ?? 0) + Number(body.idempotentRowCount ?? 0) !==
      preview.rows.length ||
    body.purchaseUseAllowed !== true ||
    body.priceUseAllowed !== false ||
    body.confirmedReceiptUseAllowed !== false ||
    body.inventoryWriteAllowed !== false
  ) {
    throw new Error("SOURCE_ORDER_COST_IMPORT_READBACK_INVALID");
  }
  return {
    ...body,
    importFingerprint: preview.importFingerprint,
    importedBarcodes: preview.rows.map((row) => row.barcode),
    unresolvedLegacyBarcodes: preview.unresolvedLegacyBarcodes,
    actualPurchaseExecuted: false as const,
  };
}
