import assert from "node:assert/strict";
import test from "node:test";
import {
  legacySeoRegistrationExclusion,
  legacySeoRegistrationExclusionFromPolicy,
} from "../src/lib/legacySeoRegistrationPolicy.ts";

test("명시적 등록 제외 정책을 우선한다", () => {
  assert.deepEqual(
    legacySeoRegistrationExclusionFromPolicy({ excluded: true, reason: "단종" }),
    { excluded: true, reason: "단종" },
  );
});

test("정규화 옵션이 없는 이전상품은 B코드를 만들어내지 않고 자동 제외한다", () => {
  const result = legacySeoRegistrationExclusion({
    modelNumber: "AAA000",
    orderOptions: [],
  });
  assert.equal(result.excluded, true);
  assert.match(result.reason, /묶음옵션\/B코드 없음/);
});

test("정규화 옵션이 있으면 자동 제외하지 않는다", () => {
  assert.deepEqual(
    legacySeoRegistrationExclusion({
      modelNumber: "AAA001",
      orderOptions: [{ barcode: "BAA1-1", saleOption: "단품" }],
    }),
    { excluded: false, reason: "" },
  );
});
