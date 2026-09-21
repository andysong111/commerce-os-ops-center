import assert from "node:assert/strict";
import test from "node:test";

import { resolveExistingSourcingPurchase } from "../src/domain/sourcing-purchase-replay.ts";

const identity = {
  intakeId: "11111111-1111-4111-8111-111111111111",
  outboxId: "22222222-2222-4222-8222-222222222222",
  barcode: "BBA8-3",
  modelNumber: "AAA493",
  productName: "검증 신규상품",
  quantity: 5,
};

function commitment(overrides = {}) {
  return {
    sourceSystem: "fast-purchase-mvp",
    sourceLineId: "fast-purchase-draft:0123456789abcdefabcd:BBA8-3",
    sourceRunId: "fast-purchase-draft:0123456789abcdefabcd",
    barcode: "BBA8-3",
    requestedQuantity: 5,
    reservedAt: "2026-09-30T14:30:00.000Z",
    updatedAt: "2026-10-01T02:00:00.000Z",
    latestPayload: {
      sourcingConfirmed: true,
      sourcingIntakeId: identity.intakeId,
      sourcingOutboxId: identity.outboxId,
      modelNo: identity.modelNumber,
      productName: identity.productName,
    },
    ...overrides,
  };
}

test("response-loss retry after month rollover reuses the original September draft", () => {
  const result = resolveExistingSourcingPurchase([commitment()], identity);
  assert.equal(result?.duplicate, true);
  assert.equal(result?.draftId, "fast-purchase-draft:0123456789abcdefabcd");
  assert.equal(result?.cycleMonth, "2026-09");
  assert.equal(result?.externalLineId, "fast-purchase-draft:0123456789abcdefabcd:BBA8-3");
  assert.equal(result?.externalOrderExecuted, false);
});

test("later ORDERED or RECEIVED payload fields do not erase original sourcing replay identity", () => {
  const result = resolveExistingSourcingPurchase([
    commitment({
      latestPayload: {
        sourcingConfirmed: true,
        sourcingIntakeId: identity.intakeId,
        sourcingOutboxId: identity.outboxId,
        modelNo: identity.modelNumber,
        productName: identity.productName,
        orderNumber: "order-1",
        receiptId: "receipt-1",
      },
      updatedAt: "2026-10-12T02:00:00.000Z",
    }),
  ], identity);
  assert.equal(result?.duplicate, true);
  assert.equal(result?.cycleMonth, "2026-09");
});

test("same outbox or intake with changed immutable identity fails closed", () => {
  for (const changed of [
    { ...identity, barcode: "BBA8-4" },
    { ...identity, modelNumber: "AAA999" },
    { ...identity, productName: "다른 상품" },
    { ...identity, quantity: 6 },
  ]) {
    assert.throws(
      () => resolveExistingSourcingPurchase([commitment()], changed),
      /SOURCING_PURCHASE_REPLAY_IDENTITY_CONFLICT/,
    );
  }
});

test("two ledger lines claiming the same sourcing identity are never silently chosen", () => {
  assert.throws(
    () => resolveExistingSourcingPurchase([
      commitment(),
      commitment({
        sourceLineId: "fast-purchase-draft:fedcba9876543210fedc:BBA8-3",
        sourceRunId: "fast-purchase-draft:fedcba9876543210fedc",
      }),
    ], identity),
    /SOURCING_PURCHASE_REPLAY_AMBIGUOUS/,
  );
});

test("unrelated commitments do not interfere with a new sourcing handoff", () => {
  const result = resolveExistingSourcingPurchase([
    commitment({
      latestPayload: {
        sourcingConfirmed: true,
        sourcingIntakeId: "33333333-3333-4333-8333-333333333333",
        sourcingOutboxId: "44444444-4444-4444-8444-444444444444",
        modelNo: "AAA494",
        productName: "다른 상품",
      },
    }),
  ], identity);
  assert.equal(result, null);
});

test("corrupted original draft identity fails closed instead of opening a new month", () => {
  assert.throws(
    () => resolveExistingSourcingPurchase([
      commitment({ sourceRunId: "not-a-draft" }),
    ], identity),
    /SOURCING_PURCHASE_REPLAY_DRAFT_INVALID/,
  );
});
