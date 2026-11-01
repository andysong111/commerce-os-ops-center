export type PurchaseIdentityMetadata = {
  barcode: string;
  productName: string;
  saleOption: string;
  chinaOption: string;
  supplierLink?: string;
  conflict: boolean;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function identityText(value: unknown) {
  return text(value).replace(/\s+/gu, " ").toLocaleLowerCase("ko-KR");
}

function hasCompleteSourcingIdentity(payload: Record<string, unknown>) {
  return Boolean(
    text(payload.productName) &&
      text(payload.saleOption) &&
      text(payload.chinaOption) &&
      text(payload.supplierLink),
  );
}

/**
 * Completes an explicitly confirmed sourcing line from the exact Product Launch
 * B-code when that option has not appeared in an earlier purchase Draft yet.
 * Existing complete ledger identity remains authoritative; incomplete or
 * conflicting Product Launch identity fails closed.
 */
export function completeConfirmedSourcingPayload(
  currentBarcode: string,
  expectedProductName: string,
  payload: Record<string, unknown>,
  metadataByBarcode?: ReadonlyMap<string, PurchaseIdentityMetadata> | null,
) {
  if (hasCompleteSourcingIdentity(payload)) return payload;
  if (!metadataByBarcode?.size) {
    throw new Error(`PURCHASE_SOURCING_IDENTITY_METADATA_UNAVAILABLE:${currentBarcode}`);
  }
  const metadata = metadataByBarcode.get(currentBarcode);
  const expectedName = identityText(expectedProductName || payload.productName);
  const payloadName = identityText(payload.productName);
  if (
    !metadata ||
    metadata.conflict === true ||
    !expectedName ||
    identityText(metadata.productName) !== expectedName ||
    (payloadName && payloadName !== identityText(metadata.productName))
  ) {
    throw new Error(`PURCHASE_SOURCING_BARCODE_IDENTITY_CONFLICT:${currentBarcode}`);
  }
  const completed = {
    ...payload,
    productName: text(payload.productName) || text(metadata.productName),
    saleOption: text(payload.saleOption) || text(metadata.saleOption),
    chinaOption: text(payload.chinaOption) || text(metadata.chinaOption),
    supplierLink: text(payload.supplierLink) || text(metadata.supplierLink),
    sourcingConfirmed: true,
  };
  if (!hasCompleteSourcingIdentity(completed)) {
    throw new Error(`PURCHASE_SOURCING_IDENTITY_INCOMPLETE:${currentBarcode}`);
  }
  return completed;
}

export function canonicalSourcingBarcode(
  currentBarcode: string,
  payload: Record<string, unknown>,
  metadataByBarcode?: ReadonlyMap<string, PurchaseIdentityMetadata> | null,
) {
  if (metadataByBarcode === undefined) return currentBarcode;
  if (!metadataByBarcode?.size) {
    throw new Error(`PURCHASE_SOURCING_IDENTITY_METADATA_UNAVAILABLE:${currentBarcode}`);
  }
  const productName = identityText(payload.productName);
  const saleOption = identityText(payload.saleOption);
  const chinaOption = identityText(payload.chinaOption);
  if (!productName || (!saleOption && !chinaOption)) {
    throw new Error(`PURCHASE_SOURCING_IDENTITY_INCOMPLETE:${currentBarcode}`);
  }
  const matchesIdentity = (metadata: PurchaseIdentityMetadata) =>
    metadata.conflict !== true &&
    identityText(metadata.productName) === productName &&
    (
      (saleOption && identityText(metadata.saleOption) === saleOption) ||
      (chinaOption && identityText(metadata.chinaOption) === chinaOption)
    );
  const current = metadataByBarcode.get(currentBarcode);
  if (current && matchesIdentity(current)) return currentBarcode;
  const matches = [...metadataByBarcode.values()].filter(matchesIdentity);
  if (matches.length !== 1) {
    throw new Error(`PURCHASE_SOURCING_BARCODE_IDENTITY_CONFLICT:${currentBarcode}`);
  }
  return matches[0].barcode;
}
