import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const { buildPurchaseDraftBatchRecalculationHref } = await import(
  new URL("../src/lib/purchaseDraftBatchRecalculation.ts", import.meta.url)
);

test("batch recalculation carries quantity edits, exclusions, and additions in one request", () => {
  const href = buildPurchaseDraftBatchRecalculationHref({
    regenerationHref: "/purchase-cycle-preflight?check=1&replace=fast-purchase-draft%3Aabc",
    origin: "https://commerce-os.example",
    excludedBarcodes: ["BAD1-1"],
    quantityOverrides: [
      { barcode: "BAC1-1", targetQuantity: 38 },
      { barcode: "BAE5-1", targetQuantity: 12 },
    ],
  });
  const url = new URL(href, "https://commerce-os.example");
  assert.deepEqual(url.searchParams.getAll("exclude"), ["BAD1-1"]);
  assert.deepEqual(url.searchParams.getAll("qty"), ["BAC1-1:38", "BAE5-1:12"]);
  assert.equal(url.searchParams.get("replace"), "fast-purchase-draft:abc");
});

test("excluded products cannot also be fixed as quantity additions", () => {
  const href = buildPurchaseDraftBatchRecalculationHref({
    regenerationHref: "/purchase-cycle-preflight?exclude=OLD1-1&qty=OLD1-1%3A9",
    origin: "https://commerce-os.example",
    excludedBarcodes: ["BAD1-1", "bad1-1"],
    quantityOverrides: [
      { barcode: "BAD1-1", targetQuantity: 30 },
      { barcode: "BAC1-1", targetQuantity: 0 },
      { barcode: "BAE5-1", targetQuantity: 15 },
    ],
  });
  const url = new URL(href, "https://commerce-os.example");
  assert.deepEqual(url.searchParams.getAll("exclude"), ["BAD1-1"]);
  assert.deepEqual(url.searchParams.getAll("qty"), ["BAE5-1:15"]);
});

test("draft editor exposes one final calculation action and stages additions without writing", async () => {
  const workspace = await readFile(
    "src/components/china-order-manager/InternalChinaPurchaseDraftWorkspaceV2.tsx",
    "utf8",
  );
  const addition = await readFile(
    "src/components/china-order-manager/InternalChinaManualDraftLineAdder.tsx",
    "utf8",
  );
  assert.match(workspace, /변경사항 모아 발주안 재계산/);
  assert.match(workspace, /수량 변경 \{changedQuantityRows\.length\}종 · 제외 \{excludedBarcodes\.length\}종 · 추가 \{stagedAdditions\.length\}종/);
  assert.doesNotMatch(workspace, /regenerateWithoutSelected|regenerateWithQuantityChanges/);
  assert.doesNotMatch(addition, /method: "POST"|postAdd\(/);
  assert.match(addition, /재계산 전 원장 미변경/);
});
