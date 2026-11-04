import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyManualDraftBulkQuantity } from "../src/lib/internalChinaManualDraftQuantityCore.ts";

const source = await readFile(
  new URL(
    "../src/components/china-order-manager/InternalChinaManualDraftLineAdder.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("manual China draft add supports checkbox bulk staging", () => {
  assert.match(source, /aria-label="추가 가능한 B-code 전체선택"/);
  assert.match(source, /일괄 추가 선택/);
  assert.match(source, /function toggleAll\(checked: boolean\)/);
  assert.match(source, /전체 계산 대기 \{stagedAdditions\.length\}종/);
  assert.match(source, /selectedTotalQuantity/);
});

test("bulk staging excludes existing draft rows and preserves per-row quantities", () => {
  assert.match(source, /selectableCandidates = candidates\.filter\(\(candidate\) => !candidate\.inDraft\)/);
  assert.match(source, /targetQuantity = quantity\(quantities\[candidate\.barcode\] \?\? 5\)/);
  assert.match(source, /isPurchaseDraftQuantityUnit\(targetQuantity\)/);
  assert.match(source, /onStagedAdditionsChange\(\[\.\.\.retained, \.\.\.additions\]\)/);
  assert.doesNotMatch(source, /postAdd\(/);
});

test("bulk staging leaves the server draft untouched until explicit direct save", () => {
  assert.match(source, /저장 전 원장 미변경/);
  assert.match(source, /재계산 없이 변경 저장/);
  assert.doesNotMatch(source, /router\.refresh\(\)/);
  assert.doesNotMatch(source, /method: "POST"/);
  assert.doesNotMatch(source, /window\.location\.reload/);
});

test("bulk quantity updates only selected staged additions", () => {
  const rows = [
    { barcode: "BBA4-1", targetQuantity: 5, productName: "머플러" },
    { barcode: "BBA4-2", targetQuantity: 10, productName: "머플러" },
    { barcode: "BBA5-1", targetQuantity: 15, productName: "브로치" },
  ];

  assert.deepEqual(
    applyManualDraftBulkQuantity(rows, ["BBA4-1", "BBA5-1"], 25),
    [
      { barcode: "BBA4-1", targetQuantity: 25, productName: "머플러" },
      { barcode: "BBA4-2", targetQuantity: 10, productName: "머플러" },
      { barcode: "BBA5-1", targetQuantity: 25, productName: "브로치" },
    ],
  );
  assert.equal(rows[0].targetQuantity, 5);
});

test("search result quantity editing and step movement expose visible feedback", () => {
  assert.match(source, /stagedDraftQuantities/);
  assert.match(source, /onStagedDraftQuantityChange/);
  assert.match(source, /선택 품목 일괄수량/);
  assert.match(source, /applyManualDraftBulkQuantity/);
  assert.match(source, /document\.getElementById\("purchase-draft-recalculate"\)/);
  assert.match(source, /scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
  assert.match(source, /aria-busy=\{movingToRecalculate\}/);
  assert.match(source, /4단계로 이동 중\.\.\./);
});
