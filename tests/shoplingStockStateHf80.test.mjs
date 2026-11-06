import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  planShoplingGoodsKeyStateTransition,
} from "../src/lib/shopling/shoplingGoodsKeyTransmission.ts";
import {
  buildHf80TransmissionGroups,
  patchHf80BackgroundSource,
} from "../src/lib/shoplingStockHf80Patch.ts";

const optionShape = { goodsKey: "111882", optionCount: 3 };

test("HF80 sends general product sold-out when the final sellable option becomes sold out", () => {
  const plan = planShoplingGoodsKeyStateTransition({
    logicalProductKind: "OPTION",
    shape: optionShape,
    desiredStatus: "SOLD_OUT",
    productSaleStatusBefore: "B",
    sellableOptionCountAfter: 0,
    soldOutOptionCountAfter: 3,
  });
  assert.equal(plan.transitionReason, "OPTION_FULL_SOLD_OUT");
  assert.equal(plan.applyExactOptionStatus, true);
  assert.equal(plan.applyProductSaleStatus, true);
  assert.equal(plan.productStatusTarget, "SOLD_OUT");
  assert.deepEqual(
    plan.transmissions.map((row) => [row.sequence, row.transmissionKind]),
    [[1, "PRODUCT_SALE_STATUS_SEND"]],
  );
});

test("HF80 exposes a fully sold-out product before sending its recovered options", () => {
  const plan = planShoplingGoodsKeyStateTransition({
    logicalProductKind: "OPTION",
    shape: optionShape,
    desiredStatus: "ON_SALE",
    productSaleStatusBefore: "C",
    sellableOptionCountAfter: 1,
    soldOutOptionCountAfter: 2,
  });
  assert.equal(plan.transitionReason, "OPTION_PARTIAL_RECOVERY");
  assert.equal(plan.productStatusTarget, "ON_SALE");
  assert.deepEqual(
    plan.transmissions.map((row) => [row.sequence, row.transmissionKind]),
    [
      [1, "PRODUCT_SALE_STATUS_SEND"],
      [2, "OPTION_SEND"],
    ],
  );
});

test("HF80 keeps partial option changes on the option lane and split one-option products on the product lane", () => {
  const partial = planShoplingGoodsKeyStateTransition({
    logicalProductKind: "OPTION",
    shape: optionShape,
    desiredStatus: "SOLD_OUT",
    productSaleStatusBefore: "B",
    sellableOptionCountAfter: 2,
    soldOutOptionCountAfter: 1,
  });
  assert.equal(partial.transitionReason, "OPTION_PARTIAL_STATE");
  assert.equal(partial.applyProductSaleStatus, false);
  assert.equal(partial.transmissions[0].transmissionKind, "OPTION_SEND");

  const split = planShoplingGoodsKeyStateTransition({
    logicalProductKind: "OPTION",
    shape: { goodsKey: "122563", optionCount: 1 },
    desiredStatus: "SOLD_OUT",
    productSaleStatusBefore: "B",
    sellableOptionCountAfter: 0,
    soldOutOptionCountAfter: 1,
  });
  assert.equal(split.transitionReason, "SPLIT_ONE_OPTION_PRODUCT");
  assert.equal(split.applyExactOptionStatus, true);
  assert.equal(split.applyProductSaleStatus, true);
  assert.equal(
    split.transmissions[0].transmissionKind,
    "PRODUCT_SALE_STATUS_SEND",
  );
});

test("HF80 fails closed when aggregate option statuses cannot be fully classified", () => {
  assert.throws(
    () =>
      planShoplingGoodsKeyStateTransition({
        logicalProductKind: "OPTION",
        shape: optionShape,
        desiredStatus: "SOLD_OUT",
        productSaleStatusBefore: "B",
        sellableOptionCountAfter: 1,
        soldOutOptionCountAfter: 1,
      }),
    /SHOPLING_OPTION_AGGREGATE_STATUS_UNCERTAIN/,
  );
});

test("HF80 groups staged recovery by sequence and preserves product-before-option dependency", () => {
  const goodsKeys = ["111882", "111883"];
  const result = buildHf80TransmissionGroups(
    [
      {
        goodsKey: "111882",
        optionCount: 3,
        sequence: 1,
        transmissionKind: "PRODUCT_SALE_STATUS_SEND",
        effectiveProductKind: "SINGLE",
      },
      {
        goodsKey: "111882",
        optionCount: 3,
        sequence: 2,
        transmissionKind: "OPTION_SEND",
        effectiveProductKind: "OPTION",
      },
      {
        goodsKey: "111883",
        optionCount: 2,
        sequence: 1,
        transmissionKind: "OPTION_SEND",
        effectiveProductKind: "OPTION",
      },
    ],
    goodsKeys,
  );
  assert.deepEqual(
    result.groups.map((group) => [
      group.sequence,
      group.transmissionKind,
      group.goodsKeys,
    ]),
    [
      [1, "PRODUCT_SALE_STATUS_SEND", ["111882"]],
      [1, "OPTION_SEND", ["111883"]],
      [2, "OPTION_SEND", ["111882"]],
    ],
  );
  assert.throws(
    () =>
      buildHf80TransmissionGroups(
        [
          {
            goodsKey: "111882",
            optionCount: 3,
            sequence: 1,
            transmissionKind: "OPTION_SEND",
            effectiveProductKind: "OPTION",
          },
          {
            goodsKey: "111882",
            optionCount: 3,
            sequence: 1,
            transmissionKind: "PRODUCT_SALE_STATUS_SEND",
            effectiveProductKind: "SINGLE",
          },
        ],
        ["111882"],
      ),
    /SHOPLING_HF80_DUPLICATE_STEP/,
  );
});

test("HF80 package preserves the proven blue-radio click chain and advances the production gate", async () => {
  const [backgroundBase, route, page, planner, optionStatusRoute, optionStatus, workflow] =
    await Promise.all([
      readFile("public/shopling-stock-state-sync/background-v092.js", "utf8"),
      readFile("src/app/api/shopling-stock-state-sync/download-hf80/route.ts", "utf8"),
      readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
      readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
      readFile("src/app/api/inventory-stock-control/shopling-option-status/route.ts", "utf8"),
      readFile("src/lib/shopling/shoplingOptionStatus.ts", "utf8"),
      readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
    ]);
  const patchedBackground = patchHf80BackgroundSource(backgroundBase);
  new Function(patchedBackground);
  assert.match(patchedBackground, /PRODUCT_SALE_STATUS_SEND", "OPTION_SEND/);
  assert.match(patchedBackground, /SHOPLING_HF80_STEP_SEQUENCE_INVALID/);
  assert.match(route, /const BASE_VERSION = "0\.6\.42"/);
  assert.match(route, /const VERSION = "0\.6\.43"/);
  assert.match(route, /visibleA21ClickBaseline: "HF69_PRESERVED"/);
  assert.match(route, /popupOwnershipBaseline: "HF79_PRESERVED"/);
  assert.match(page, /download-hf80/);
  assert.match(page, /v0\.6\.43 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 43\]/);
  assert.match(optionStatusRoute, /planShoplingGoodsKeyStateTransition/);
  assert.match(optionStatusRoute, /inspectionAfterOption\.sellableOptionCount/);
  assert.match(optionStatus, /unsupportedOptionStatusCount/);
  assert.match(workflow, /shoplingStockStateHf80\.test\.mjs/);
});
