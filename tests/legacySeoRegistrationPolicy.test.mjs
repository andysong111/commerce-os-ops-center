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
  assert.deepEqual(
    legacySeoRegistrationExclusion({
      legacySeoRegistrationPolicy: { excluded: true, reason: "관리자 제외" },
      orderOptions: [{ barcode: "BAA1-1", saleOption: "단품" }],
    }),
    { excluded: true, reason: "관리자 제외" },
  );
});

test("정규화 옵션이 없는 이전상품은 숨기지 않고 준비점검에서 막는다", () => {
  const result = legacySeoRegistrationExclusion({
    modelNumber: "AAA000",
    orderOptions: [],
  });
  assert.deepEqual(result, { excluded: false, reason: "" });
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

test("사용자가 단종 확정한 상품은 별도 SEO 정책이 없어도 제외한다", () => {
  assert.deepEqual(
    legacySeoRegistrationExclusion({
      modelNumber: "AAA034",
      discontinuation: {
        status: "confirmed",
        reason: "사용자 단종 확인",
      },
    }),
    { excluded: true, reason: "사용자 단종 확인" },
  );
});

test("단종 검토 중인 상품은 자동 제외하지 않는다", () => {
  assert.deepEqual(
    legacySeoRegistrationExclusion({
      modelNumber: "AAA001",
      discontinuation: { status: "review" },
    }),
    { excluded: false, reason: "" },
  );
});

test("창고 위치 확인 대상은 옵션이 있어도 SEO 등록에서 제외한다", () => {
  const result = legacySeoRegistrationExclusion({
    modelNumber: "AAA028",
    orderOptions: [{ barcode: "BAA1-1", saleOption: "단품" }],
  });
  assert.equal(result.excluded, true);
  assert.match(result.reason, /창고 위치 확인 필요 32건/);
});
