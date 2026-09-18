import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BARCODE = /^[A-Z]{3}\d+-\d+$/;

type RecordLike = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}
function record(value: unknown): RecordLike {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordLike)
    : {};
}
function stableUuid(key: string) {
  const hex = createHash("sha256")
    .update("commerce-os:sourcing-receipt:v1\0" + key)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  const variant = parseInt(hex[16], 16);
  hex[16] = ((variant & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20),
  ].join("-");
}
function connection() {
  const base = (
    process.env.SOURCING_STORAGE_INTAKE_URL ||
    "https://storage-organization.vercel.app/api/sourcing-intake"
  ).trim();
  const secret = (
    process.env.SOURCING_ENGINE_INTEGRATION_SECRET ||
    process.env.PRODUCT_MASTER_INTEGRATION_SECRET
  )?.trim();
  const url = new URL(base);
  if (url.protocol !== "https:" || !secret) {
    throw new Error("SOURCING_WAREHOUSE_RECEIPT_CONNECTION_REQUIRED");
  }
  return { url: url.toString(), secret };
}

export function sourcingMetadataFromCommitmentPayload(value: unknown) {
  const payload = record(value);
  if (payload.sourcingConfirmed !== true) return null;
  const intakeId = text(payload.sourcingIntakeId).toLowerCase();
  if (!UUID.test(intakeId)) throw new Error("SOURCING_WAREHOUSE_INTAKE_ID_INVALID");
  return {
    intakeId,
    outboxId: text(payload.sourcingOutboxId).toLowerCase(),
    modelNumber: text(payload.modelNo).toUpperCase(),
    productName: text(payload.productName),
    saleOption: text(payload.saleOption),
    chinaOption: text(payload.chinaOption),
    supplierLink: text(payload.supplierLink),
  };
}

export async function confirmSourcingWarehouseReceipt(input: {
  receiptId: string;
  barcode: string;
  payload: unknown;
}) {
  const metadata = sourcingMetadataFromCommitmentPayload(input.payload);
  if (!metadata) return null;
  const receiptId = text(input.receiptId).toLowerCase();
  const barcode = text(input.barcode).toUpperCase().replace(/\s+/g, "");
  if (!UUID.test(receiptId) || !BARCODE.test(barcode)) {
    throw new Error("SOURCING_WAREHOUSE_RECEIPT_IDENTITY_INVALID");
  }

  const requestId = stableUuid(metadata.intakeId + ":" + receiptId + ":" + barcode);
  const { url, secret } = connection();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-commerce-os-integration-secret": secret,
    },
    body: JSON.stringify({
      action: "sourcing_received",
      requestId,
      intakeId: metadata.intakeId,
      assignedCode: barcode,
      receiptExternalId: "china-receipt:" + receiptId + ":" + barcode,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null) as RecordLike | null;
  if (!response.ok || body?.ok !== true || body?.status !== "RECEIVED") {
    const code = text(body?.error || body?.code) || "SOURCING_WAREHOUSE_RECEIPT_FAILED";
    throw new Error(code);
  }
  if (
    text(body.assignedCode).toUpperCase() !== barcode ||
    text(body.modelNumber).toUpperCase() !== metadata.modelNumber
  ) {
    throw new Error("SOURCING_WAREHOUSE_RECEIPT_IDENTITY_DRIFT");
  }
  return {
    ...metadata,
    requestId,
    skuId: text(body.skuId),
    productId: text(body.productId),
    receivedAt: text(body.receivedAt),
  };
}
