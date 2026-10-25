import assert from "node:assert/strict";
import test from "node:test";

import {
  PRODUCT_LAUNCH_PRICE_ROUND_UP_UNIT_KRW,
  productLaunchSalePriceFromUnitCostKrw,
  roundUpProductLaunchPriceKrw,
} from "../src/lib/productLaunchPricePolicy.ts";

test("상품출시 기준판매가는 일의자리를 올려 10원 단위로 저장한다", () => {
  assert.equal(PRODUCT_LAUNCH_PRICE_ROUND_UP_UNIT_KRW, 10);
  assert.equal(roundUpProductLaunchPriceKrw(1174), 1180);
  assert.equal(roundUpProductLaunchPriceKrw(1814), 1820);
  assert.equal(roundUpProductLaunchPriceKrw(1790), 1790);
  assert.equal(roundUpProductLaunchPriceKrw(0), 0);
});

test("원가 두 배 가격도 계산 뒤 10원 단위로 올린다", () => {
  assert.equal(productLaunchSalePriceFromUnitCostKrw(587), 1180);
  assert.equal(productLaunchSalePriceFromUnitCostKrw(907), 1820);
  assert.equal(productLaunchSalePriceFromUnitCostKrw(1034), 2070);
});
