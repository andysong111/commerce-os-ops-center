export type PurchaseIdentityMetadata = {
  barcode: string;
  productName: string;
  saleOption: string;
  chinaOption: string;
  conflict: boolean;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function identityText(value: unknown) {
  return text(value).replace(/\s+/gu, " ").toLocaleLowerCase("ko-KR");
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
