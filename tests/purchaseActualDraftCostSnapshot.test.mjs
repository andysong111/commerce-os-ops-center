import assert from "node:assert/strict";
import test from "node:test";
import { buildPurchaseActualDraftCostSnapshot } from "../src/lib/purchaseActualDraftCostSnapshot.ts";

test("5-1 grouped freight is divided by the full group quantity and pinned in the cost fingerprint", () => {
  const draft = {
    draftId: "fast-purchase-draft:1234567890abcdef1234",
    savedAt: "2026-10-28T01:00:00.000Z",
    exchangeRateKrwPerCny: 230,
    lines: [
      {
        barcode: "BAA1-1",
        quantity: 10,
        unitPriceCny: 5,
        freightGroupId: "SELLER-1",
        domesticChinaFreightCny: 30,
      },
      {
        barcode: "BAA1-2",
        quantity: 20,
        unitPriceCny: 7,
        freightGroupId: "SELLER-1",
        domesticChinaFreightCny: 0,
      },
    ],
  };

  const first = buildPurchaseActualDraftCostSnapshot(draft, "2026-10-28T01:01:00.000Z");
  const second = buildPurchaseActualDraftCostSnapshot(draft, "2026-10-28T01:02:00.000Z");

  assert.deepEqual(
    first.rows.map((row) => [row.barcode, row.freightPerUnitCny, row.unitCostKrw]),
    [
      ["BAA1-1", 1, 1_380],
      ["BAA1-2", 1, 1_840],
    ],
  );
  assert.equal(first.contentFingerprint, second.contentFingerprint);
  assert.notEqual(first.readAt, second.readAt);
});
