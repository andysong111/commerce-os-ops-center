import assert from "node:assert/strict";
import test from "node:test";

import { readManualPilotCatalogSnapshot } from "../src/lib/manualPilotCatalogSnapshot.ts";

test("owner-removed towel rack stays out of the verified manual pilot snapshot", () => {
  const catalog = readManualPilotCatalogSnapshot();

  assert.equal(catalog.snapshotFallback, true);
  assert.equal(catalog.selectionRunId, "5866f503-4bef-415e-84b8-0deff7fd4aa2");
  assert.equal(catalog.selectedConceptCount, 8);
  assert.equal(catalog.availableCandidateCount, 8);
  assert.equal(catalog.candidates.length, 8);
  assert.equal(catalog.businessWritesEnabled, false);
  assert.equal(catalog.externalOrderExecuted, false);
  assert.ok(catalog.candidates.every(candidate => (
    candidate.reviewRequired === true &&
    candidate.automaticOrderAllowed === false &&
    candidate.strictTestReady === false &&
    /^https:\/\/detail\.1688\.com\/offer\/\d+\.html$/.test(candidate.sourceUrl) &&
    candidate.variants.length === 1
  )));
  assert.deepEqual(catalog.candidates.map(candidate => candidate.canonicalNameKo), [
    "가정용 조절형 틈새 청소 브러시",
    "데이터케이블 보관케이스",
    "브러시 손잡이형",
    "수납박스 손잡이형",
    "케이블 정리함 탁하부형",
    "투명 수납박스 슬림형",
    "투명 파우치 4종 세트",
    "투명 플라스틱 서랍형 수납함",
  ]);
  assert.ok(!catalog.candidates.some(candidate => candidate.offerId === "680321187119"));
});
