import assert from "node:assert/strict";
import test from "node:test";

import {
  inferProductGroupFromPtnGoodsCd,
  inferSelfCodeBaseFromPtnGoodsCd,
} from "../src/lib/productGroup.ts";

test("verified legacy DM and SM prefixes share the canonical profile parser", () => {
  assert.deepEqual(inferProductGroupFromPtnGoodsCd("DM1_PLRA9A9090997"), {
    groupSuffix: "a",
    productGroup: "도매1",
    productGroupType: "도매",
    productGroupStatus: "registered",
  });
  assert.deepEqual(inferProductGroupFromPtnGoodsCd("SM2_PLRA9A9090997"), {
    groupSuffix: "f",
    productGroup: "소매2",
    productGroupType: "소매",
    productGroupStatus: "registered",
  });
  assert.equal(
    inferSelfCodeBaseFromPtnGoodsCd("DM1_PLRA9A9090997"),
    "PLRA9A9090997",
  );
  assert.equal(
    inferSelfCodeBaseFromPtnGoodsCd("SM2_PLRA9A9090997"),
    "PLRA9A9090997",
  );
});

test("empty legacy prefix and current suffix behavior remain fail-closed", () => {
  assert.equal(
    inferProductGroupFromPtnGoodsCd("DM1_").productGroupStatus,
    "missing",
  );
  assert.equal(inferSelfCodeBaseFromPtnGoodsCd("TEST1-1a"), "TEST1-1");
});
