import assert from "node:assert/strict";
import test from "node:test";
import {
  SEO_USER_CONFIRMED_SOLD_OUT_MODELS,
  SEO_USER_DEFERRED_MODELS,
  SEO_WAREHOUSE_LOCATION_REVIEW_MODELS,
  seoCatalogExclusion,
} from "../src/lib/seoCatalogExclusionPolicy.ts";

test("창고 위치 확인 32건은 SEO 등록에서 정확히 제외한다", () => {
  assert.equal(SEO_WAREHOUSE_LOCATION_REVIEW_MODELS.size, 32);
  for (const modelNumber of SEO_WAREHOUSE_LOCATION_REVIEW_MODELS) {
    const result = seoCatalogExclusion(modelNumber);
    assert.equal(result.excluded, true, modelNumber);
    assert.equal(result.code, "WAREHOUSE_LOCATION_REVIEW_REQUIRED");
  }
});

test("사용자가 확정한 품절·보류 상품은 SEO 등록에서 제외한다", () => {
  assert.deepEqual([...SEO_USER_CONFIRMED_SOLD_OUT_MODELS], [
    "AAA162",
    "AAA252",
    "AAA271",
  ]);
  assert.deepEqual([...SEO_USER_DEFERRED_MODELS], ["AAA189"]);
  assert.equal(seoCatalogExclusion("AAA162").code, "USER_CONFIRMED_SOLD_OUT");
  assert.equal(seoCatalogExclusion("AAA189").code, "USER_DEFERRED");
});

test("32건 밖의 모델은 창고 위치 정책으로 제외하지 않는다", () => {
  assert.deepEqual(seoCatalogExclusion("AAA493"), {
    excluded: false,
    code: "",
    reason: "",
  });
});
