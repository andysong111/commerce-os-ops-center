import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

test("bulk staging leaves the server draft untouched until recalculation", () => {
  assert.match(source, /재계산 전 원장 미변경/);
  assert.doesNotMatch(source, /router\.refresh\(\)/);
  assert.doesNotMatch(source, /method: "POST"/);
  assert.doesNotMatch(source, /window\.location\.reload/);
});
