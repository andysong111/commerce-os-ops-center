import assert from "node:assert/strict";
import test from "node:test";
import {
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

test("32건 밖의 모델은 창고 위치 정책으로 제외하지 않는다", () => {
  assert.deepEqual(seoCatalogExclusion("AAA493"), {
    excluded: false,
    code: "",
    reason: "",
  });
});
