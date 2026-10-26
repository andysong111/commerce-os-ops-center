import { createHmac, timingSafeEqual } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BCODE = /^B[A-Z]{1,2}\d+-\d+$/;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function secret(request: Request, env: NodeJS.ProcessEnv) {
  const expected = env.WAREHOUSE_STOCK_COMMAND_SECRET?.trim() ?? "";
  const supplied = request.headers
    .get("x-commerce-os-integration-secret")
    ?.trim() ?? "";
  if (expected.length < 32 || !supplied || !safeEqual(supplied, expected)) {
    return "";
  }
  return expected;
}

function decode(token: unknown, key: string) {
  if (typeof token !== "string" || token.length > 12_000) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", key).update(payload).digest("base64url");
  if (!safeEqual(signature, expected)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function live(value: Record<string, unknown>, now: number, maxFuture: number) {
  const expiresAt = Number(value.exp);
  return (
    value.v === 1 &&
    Number.isInteger(expiresAt) &&
    expiresAt > now / 1000 &&
    expiresAt <= now / 1000 + maxFuture
  );
}

export type WarehousePrepareProof = {
  purpose: "prepare";
  requestId: string;
  skuId: string;
  slotCode: string;
  barcode: string;
  desiredStatus: "SOLD_OUT" | "ON_SALE";
  occurredAt: string;
};

export type WarehouseExecuteProof = {
  purpose: "execute";
  requestId: string;
  skuId: string;
  slotCode: string;
  job: {
    jobId: string;
    barcode: string;
    productName: string;
    productKind: "SINGLE" | "OPTION";
    modelNo: string | null;
    goodsKeys: string[];
    desiredStatus: "SOLD_OUT" | "ON_SALE";
    desiredSince: string;
    exactInventoryQuantity: number;
    inventoryQuantityKnown: boolean;
    manualStatusOnly: boolean;
    resetAt: string;
    route: string[];
    directOperatorCommand: boolean;
  };
};

export function verifyWarehouseStockCommand(
  request: Request,
  body: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): WarehousePrepareProof | WarehouseExecuteProof | null {
  const key = secret(request, env);
  if (!key) return null;
  const value = decode(body.commandToken, key);
  if (!value) return null;
  if (value.purpose === "prepare" && live(value, now, 360)) {
    const requestId = text(value.requestId);
    const skuId = text(value.skuId);
    const slotCode = text(value.slotCode).toUpperCase();
    const barcode = text(value.barcode).toUpperCase();
    const desiredStatus = text(value.desiredStatus).toUpperCase();
    const occurredAt = text(value.occurredAt);
    if (
      !UUID.test(requestId) ||
      !skuId ||
      !BCODE.test(slotCode) ||
      !BCODE.test(barcode) ||
      !["SOLD_OUT", "ON_SALE"].includes(desiredStatus) ||
      !Number.isFinite(Date.parse(occurredAt)) ||
      text(body.requestId) !== requestId ||
      text(body.batchId) !== `warehouse-${requestId}` ||
      text(body.skuId) !== skuId ||
      text(body.slotCode).toUpperCase() !== slotCode ||
      text(body.barcode).toUpperCase() !== barcode ||
      text(body.desiredStatus).toUpperCase() !== desiredStatus ||
      text(body.occurredAt) !== occurredAt
    ) {
      return null;
    }
    return {
      purpose: "prepare",
      requestId,
      skuId,
      slotCode,
      barcode,
      desiredStatus: desiredStatus as "SOLD_OUT" | "ON_SALE",
      occurredAt,
    };
  }
  if (value.purpose === "execute" && live(value, now, 3_660)) {
    const requestId = text(value.requestId);
    const skuId = text(value.skuId);
    const slotCode = text(value.slotCode).toUpperCase();
    const jobValue = value.job;
    if (!jobValue || typeof jobValue !== "object" || Array.isArray(jobValue)) {
      return null;
    }
    const row = jobValue as Record<string, unknown>;
    const jobId = text(row.jobId);
    const barcode = text(row.barcode).toUpperCase();
    const productKind = text(row.productKind).toUpperCase();
    const desiredStatus = text(row.desiredStatus).toUpperCase();
    const desiredSince = text(row.desiredSince);
    if (
      !UUID.test(requestId) ||
      !skuId ||
      !BCODE.test(slotCode) ||
      !jobId ||
      !BCODE.test(barcode) ||
      !["SINGLE", "OPTION"].includes(productKind) ||
      !["SOLD_OUT", "ON_SALE"].includes(desiredStatus) ||
      !Number.isFinite(Date.parse(desiredSince)) ||
      text(body.jobId) !== jobId ||
      text(body.barcode).toUpperCase() !== barcode ||
      text(body.desiredStatus).toUpperCase() !== desiredStatus
    ) {
      return null;
    }
    return {
      purpose: "execute",
      requestId,
      skuId,
      slotCode,
      job: {
        jobId,
        barcode,
        productName: text(row.productName),
        productKind: productKind as "SINGLE" | "OPTION",
        modelNo: text(row.modelNo).toUpperCase() || null,
        goodsKeys: Array.isArray(row.goodsKeys)
          ? row.goodsKeys.map(text).filter((item) => /^\d+$/.test(item))
          : [],
        desiredStatus: desiredStatus as "SOLD_OUT" | "ON_SALE",
        desiredSince,
        exactInventoryQuantity: Number(row.exactInventoryQuantity),
        inventoryQuantityKnown: row.inventoryQuantityKnown !== false,
        manualStatusOnly: row.manualStatusOnly === true,
        resetAt: text(row.resetAt),
        route: Array.isArray(row.route) ? row.route.map(text).filter(Boolean) : [],
        directOperatorCommand: row.directOperatorCommand === true,
      },
    };
  }
  return null;
}
