import { createHash } from "node:crypto";

export const OWNER_APPROXIMATE_PURCHASE_COST_ESTIMATE = "OWNER_APPROXIMATE_PURCHASE_COST_ESTIMATE";
export const OWNER_SIMILAR_PRODUCT_PURCHASE_COST_ESTIMATE = "OWNER_SIMILAR_PRODUCT_PURCHASE_COST_ESTIMATE";

export type PurchaseOwnerCostEstimateSource =
  | typeof OWNER_APPROXIMATE_PURCHASE_COST_ESTIMATE
  | typeof OWNER_SIMILAR_PRODUCT_PURCHASE_COST_ESTIMATE;

export type PurchaseOwnerCostEstimateRow = {
  barcode: string;
  modelNo: string;
  productName: string;
  estimatedUnitCostKrw: number;
  evidenceAt: string;
  source: PurchaseOwnerCostEstimateSource;
  referenceModelNo: string | null;
};

export type PurchaseOwnerCostEstimateSnapshot = {
  contentFingerprint: string;
  rows: PurchaseOwnerCostEstimateRow[];
  writesEnabled: false;
};

const BARCODE = /^B[A-Z]{2}\d+-\d+$/;
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const hash = (value: unknown) =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

const normalizeRows = (rows: PurchaseOwnerCostEstimateRow[]) => rows
  .map((row) => ({ ...row }))
  .sort((a, b) => a.barcode.localeCompare(b.barcode));

function validRow(row: PurchaseOwnerCostEstimateRow) {
  return BARCODE.test(row.barcode) && row.modelNo.trim().length > 0 &&
    row.productName.trim().length > 0 && positive(row.estimatedUnitCostKrw) &&
    Number.isFinite(Date.parse(row.evidenceAt)) &&
    (row.source === OWNER_APPROXIMATE_PURCHASE_COST_ESTIMATE
      ? row.referenceModelNo === null
      : row.source === OWNER_SIMILAR_PRODUCT_PURCHASE_COST_ESTIMATE &&
        typeof row.referenceModelNo === "string" && row.referenceModelNo.trim().length > 0);
}

export function buildPurchaseOwnerCostEstimateSnapshot(
  rows: PurchaseOwnerCostEstimateRow[],
): PurchaseOwnerCostEstimateSnapshot {
  const normalized = normalizeRows(rows);
  if (!normalized.every(validRow)) throw new Error("OWNER_COST_ESTIMATE_INVALID");
  if (new Set(normalized.map((row) => row.barcode)).size !== normalized.length) {
    throw new Error("OWNER_COST_ESTIMATE_DUPLICATE_BARCODE");
  }
  return {
    contentFingerprint: hash(normalized),
    rows: normalized,
    writesEnabled: false,
  };
}

export function validPurchaseOwnerCostEstimateSnapshot(
  value: PurchaseOwnerCostEstimateSnapshot | null | undefined,
) {
  if (!value || value.writesEnabled !== false || !Array.isArray(value.rows)) return false;
  try {
    const rebuilt = buildPurchaseOwnerCostEstimateSnapshot(value.rows);
    return rebuilt.contentFingerprint === value.contentFingerprint;
  } catch {
    return false;
  }
}

const evidenceAt = "2026-10-02T00:00:00+09:00";

export const PURCHASE_OWNER_COST_ESTIMATES = buildPurchaseOwnerCostEstimateSnapshot([
  { barcode: "BBB4-2", modelNo: "AAA389", productName: "코괄사 색상랜덤", estimatedUnitCostKrw: 560, evidenceAt, source: OWNER_APPROXIMATE_PURCHASE_COST_ESTIMATE, referenceModelNo: null },
  { barcode: "BCC2-2", modelNo: "AAA304", productName: "대형 S자 카라비너", estimatedUnitCostKrw: 450, evidenceAt, source: OWNER_APPROXIMATE_PURCHASE_COST_ESTIMATE, referenceModelNo: null },
  { barcode: "BDB1-3", modelNo: "AAA098", productName: "은박담요 140×210cm", estimatedUnitCostKrw: 290, evidenceAt, source: OWNER_APPROXIMATE_PURCHASE_COST_ESTIMATE, referenceModelNo: null },
  { barcode: "BDB2-1", modelNo: "AAA164", productName: "은박담요", estimatedUnitCostKrw: 350, evidenceAt, source: OWNER_APPROXIMATE_PURCHASE_COST_ESTIMATE, referenceModelNo: null },
  { barcode: "BDC4-1", modelNo: "AAA093", productName: "자동차 브러쉬 케이스포함", estimatedUnitCostKrw: 390, evidenceAt, source: OWNER_APPROXIMATE_PURCHASE_COST_ESTIMATE, referenceModelNo: null },
  { barcode: "BGC2-2", modelNo: "AAA312", productName: "비누롤러케이스 그레이", estimatedUnitCostKrw: 520, evidenceAt, source: OWNER_APPROXIMATE_PURCHASE_COST_ESTIMATE, referenceModelNo: null },
  { barcode: "BGE4-1", modelNo: "LEGACY-BGE4-1", productName: "정글모 사하라캡 뒷목가리개 성인플랩캡", estimatedUnitCostKrw: 2251, evidenceAt, source: OWNER_SIMILAR_PRODUCT_PURCHASE_COST_ESTIMATE, referenceModelNo: "AAA128" },
  { barcode: "BGF3-1", modelNo: "AAA048", productName: "왕챙 썬캡 블랙", estimatedUnitCostKrw: 2100, evidenceAt, source: OWNER_APPROXIMATE_PURCHASE_COST_ESTIMATE, referenceModelNo: null },
  { barcode: "BGF4-1", modelNo: "AAA048", productName: "왕챙 썬캡 베이지", estimatedUnitCostKrw: 2100, evidenceAt, source: OWNER_APPROXIMATE_PURCHASE_COST_ESTIMATE, referenceModelNo: null },
]);
