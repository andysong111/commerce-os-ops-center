import assert from "node:assert/strict";
import test from "node:test";

import { readManualPilotCatalogSnapshot } from "../src/lib/manualPilotCatalogSnapshot.ts";

test("verified manual pilot snapshot keeps all nine owner-selected products read-only", () => {
  const catalog = readManualPilotCatalogSnapshot();

  assert.equal(catalog.snapshotFallback, true);
  assert.equal(catalog.selectionRunId, "92fc558e-bd75-4181-8db0-2e07276b304e");
  assert.equal(catalog.selectedConceptCount, 9);
  assert.equal(catalog.availableCandidateCount, 9);
  assert.equal(catalog.candidates.length, 9);
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
    "수건행거 벽걸이 선반",
    "수납박스 손잡이형",
    "케이블 정리함 탁하부형",
    "투명 수납박스 슬림형",
    "투명 파우치 4종 세트",
    "투명 플라스틱 서랍형 수납함",
  ]);
});
