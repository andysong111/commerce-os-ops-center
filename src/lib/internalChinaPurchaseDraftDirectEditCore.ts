const BARCODE = /^[A-Z]{3}\d+-\d+$/;
const QUANTITY_MAX = 9_995;
const EDIT_LIMIT = 200;

export type PurchaseDraftDirectEditAddition = {
  barcode: string;
  targetQuantity: number;
};

export type PurchaseDraftDirectEditRequest = {
  requestId: string;
  additions: PurchaseDraftDirectEditAddition[];
  quantityChanges: PurchaseDraftDirectEditAddition[];
  excludedBarcodes: string[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function barcode(value: unknown) {
  const normalized = text(value).toUpperCase().replace(/\s+/g, "");
  if (!BARCODE.test(normalized)) {
    throw new Error(`PURCHASE_DRAFT_DIRECT_EDIT_BARCODE_INVALID:${normalized}`);
  }
  return normalized;
}

function quantity(value: unknown) {
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    !Number.isInteger(parsed) ||
    parsed < 5 ||
    parsed > QUANTITY_MAX ||
    parsed % 5 !== 0
  ) {
    throw new Error("PURCHASE_DRAFT_DIRECT_EDIT_QUANTITY_INVALID");
  }
  return parsed;
}

function rows(value: unknown, field: string) {
  if (!Array.isArray(value) || value.length > EDIT_LIMIT) {
    throw new Error(`PURCHASE_DRAFT_DIRECT_EDIT_${field}_INVALID`);
  }
  const normalized = value.map((row) => {
    const candidate = row && typeof row === "object"
      ? row as Record<string, unknown>
      : {};
    return {
      barcode: barcode(candidate.barcode),
      targetQuantity: quantity(candidate.targetQuantity),
    };
  });
  if (new Set(normalized.map((row) => row.barcode)).size !== normalized.length) {
    throw new Error(`PURCHASE_DRAFT_DIRECT_EDIT_${field}_DUPLICATE`);
  }
  return normalized.sort((left, right) => left.barcode.localeCompare(right.barcode));
}

export function normalizePurchaseDraftDirectEditRequest(
  value: unknown,
): PurchaseDraftDirectEditRequest {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const requestId = text(input.requestId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  if (requestId.length < 8) {
    throw new Error("PURCHASE_DRAFT_DIRECT_EDIT_REQUEST_ID_INVALID");
  }
  const additions = rows(input.additions, "ADDITIONS");
  const quantityChanges = rows(input.quantityChanges, "QUANTITY_CHANGES");
  const rawExcluded = input.excludedBarcodes;
  if (!Array.isArray(rawExcluded) || rawExcluded.length > EDIT_LIMIT) {
    throw new Error("PURCHASE_DRAFT_DIRECT_EDIT_EXCLUSIONS_INVALID");
  }
  const excludedBarcodes = rawExcluded.map(barcode).sort();
  if (new Set(excludedBarcodes).size !== excludedBarcodes.length) {
    throw new Error("PURCHASE_DRAFT_DIRECT_EDIT_EXCLUSIONS_DUPLICATE");
  }

  const seen = new Set<string>();
  for (const row of [...additions, ...quantityChanges]) {
    if (seen.has(row.barcode)) {
      throw new Error(`PURCHASE_DRAFT_DIRECT_EDIT_CONFLICT:${row.barcode}`);
    }
    seen.add(row.barcode);
  }
  for (const excluded of excludedBarcodes) {
    if (seen.has(excluded)) {
      throw new Error(`PURCHASE_DRAFT_DIRECT_EDIT_CONFLICT:${excluded}`);
    }
    seen.add(excluded);
  }
  if (!seen.size) throw new Error("PURCHASE_DRAFT_DIRECT_EDIT_EMPTY");

  return { requestId, additions, quantityChanges, excludedBarcodes };
}
