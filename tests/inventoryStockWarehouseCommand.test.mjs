import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const { verifyWarehouseStockCommand } = await importTranspiledTypeScript(
  new URL("../src/lib/warehouseStockCommandProof.ts", import.meta.url),
);
const secret = "warehouse-stock-command-secret-for-tests";
const env = { WAREHOUSE_STOCK_COMMAND_SECRET: secret };
const now = Date.parse("2026-10-26T06:00:00.000Z");
function token(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}

test("Ops accepts only an exact signed warehouse location and B-code prepare command", () => {
  const body = {
    action: "prepare",
    requestId: "11111111-1111-4111-8111-111111111111",
    batchId: "warehouse-11111111-1111-4111-8111-111111111111",
    skuId: "sku-1",
    slotCode: "BBB4-3",
    barcode: "BBB4-3",
    desiredStatus: "SOLD_OUT",
    occurredAt: "2026-10-26T06:00:00.000Z",
  };
  body.commandToken = token({
    v: 1,
    purpose: "prepare",
    exp: Math.floor(now / 1000) + 300,
    requestId: body.requestId,
    skuId: body.skuId,
    slotCode: body.slotCode,
    barcode: body.barcode,
    desiredStatus: body.desiredStatus,
    occurredAt: body.occurredAt,
  });
  const request = new Request(
    "https://ops.test/api/integrations/warehouse-stock-status",
    { headers: { "x-commerce-os-integration-secret": secret } },
  );
  assert.equal(
    verifyWarehouseStockCommand(request, body, env, now)?.purpose,
    "prepare",
  );
  for (const changed of [
    { ...body, barcode: "BBB4-2" },
    { ...body, slotCode: "BBB4-2" },
    { ...body, desiredStatus: "ON_SALE" },
    { ...body, commandToken: `${body.commandToken}x` },
  ]) {
    assert.equal(verifyWarehouseStockCommand(request, changed, env, now), null);
  }
  const wrongSecret = new Request(request.url, {
    headers: { "x-commerce-os-integration-secret": "wrong" },
  });
  assert.equal(verifyWarehouseStockCommand(wrongSecret, body, env, now), null);
});

test("execution token binds the extension job while allowing only discovered goods keys and terminal evidence to vary", () => {
  const job = {
    jobId: "stock-sync:BBB4-3:SOLD_OUT:2026-10-26T06:00:00.000Z",
    barcode: "BBB4-3",
    productName: "욕실 스프레이건",
    productKind: "OPTION",
    modelNo: "AAA424",
    goodsKeys: [],
    desiredStatus: "SOLD_OUT",
    desiredSince: "2026-10-26T06:00:00.000Z",
    exactInventoryQuantity: 0,
    inventoryQuantityKnown: true,
    manualStatusOnly: false,
    resetAt: "2026-10-26T06:00:00.000Z",
    route: ["SHOPLING_API_OPTION_STATUS"],
    directOperatorCommand: true,
  };
  const body = {
    action: "apply_option_status",
    jobId: job.jobId,
    barcode: job.barcode,
    desiredStatus: job.desiredStatus,
    goodsKeys: ["12345"],
  };
  body.commandToken = token({
    v: 1,
    purpose: "execute",
    exp: Math.floor(now / 1000) + 3600,
    requestId: "11111111-1111-4111-8111-111111111111",
    skuId: "sku-1",
    slotCode: "BBB4-3",
    job,
  });
  const request = new Request(
    "https://ops.test/api/integrations/warehouse-stock-status",
    { headers: { "x-commerce-os-integration-secret": secret } },
  );
  const proof = verifyWarehouseStockCommand(request, body, env, now);
  assert.equal(proof?.purpose, "execute");
  assert.equal(proof?.job.barcode, "BBB4-3");
  assert.equal(
    verifyWarehouseStockCommand(
      request,
      { ...body, barcode: "BBB4-2" },
      env,
      now,
    ),
    null,
  );
  const invalidLocationToken = token({
    v: 1,
    purpose: "execute",
    exp: Math.floor(now / 1000) + 3600,
    requestId: "not-a-request-id",
    skuId: "sku-1",
    slotCode: "NOT-A-LOCATION",
    job,
  });
  assert.equal(
    verifyWarehouseStockCommand(
      request,
      { ...body, commandToken: invalidLocationToken },
      env,
      now,
    ),
    null,
  );
});

test("warehouse integration stays isolated from existing inventory API authorization", async () => {
  const route = await readFile(
    "src/app/api/integrations/warehouse-stock-status/route.ts",
    "utf8",
  );
  assert.match(route, /verifyWarehouseStockCommand/);
  assert.match(route, /proof\.purpose === "prepare"/);
  for (const file of [
    "src/app/api/inventory-stock-control/batch/route.ts",
    "src/app/api/inventory-stock-control/on-sale/batch/route.ts",
    "src/app/api/inventory-stock-control/shopling-option-status/route.ts",
    "src/app/api/inventory-stock-control/sync/route.ts",
  ]) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(
      source,
      /WAREHOUSE_STOCK_COMMAND_SECRET|warehouseStockCommand/,
    );
  }
});

test("HF32 adds the warehouse host bridge and requires the signed command token", async () => {
  const source = await readFile(
    "src/app/api/shopling-stock-state-sync/download-hf32/route.ts",
    "utf8",
  );
  const page = await readFile(
    "src/app/china-order-manager/stock-control/page.tsx",
    "utf8",
  );
  assert.match(source, /getHf31Download/);
  assert.match(source, /https:\/\/storage-organization\.vercel\.app\/\*/);
  assert.match(source, /commandToken: job\?\.warehouseCommandToken/);
  assert.match(source, /signedCommandTokenRequired: true/);
  assert.match(source, /hf31AllDateAndExactBcodeGuardsPreserved: true/);
  assert.match(page, /download-hf32/);
  assert.match(page, /v0\.6\.0/);
});
