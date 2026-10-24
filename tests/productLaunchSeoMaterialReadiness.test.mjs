import assert from "node:assert/strict";
import test from "node:test";
import { productLaunchSeoMaterialReadiness } from "../src/lib/productLaunchSeoMaterialReadiness.ts";
import { sourcingReceiptStatus } from "../src/lib/sourcingReceiptGate.ts";

function completeItem(overrides = {}) {
  return {
    id: "item-1",
    modelNumber: "AAA900",
    productName: "테스트 상품",
    shoplingCategory: "생활 > 수납",
    selfCodeBase: "AAA900",
    detailPageAsset: {
      html: "<p>상세페이지</p>",
      mainImageUrl: "https://example.com/main.jpg",
    },
    orderOptions: [
      {
        optionName: "색상",
        saleOption: "화이트",
        barcode: "BZZ1-1",
        optionBarcodeNo: "000000009001",
        baseSalePriceKrw: 5000,
        unitCostKrw: 1000,
      },
    ],
    ...overrides,
  };
}

test("accepts a product with every Shopling registration material", () => {
  const result = productLaunchSeoMaterialReadiness(completeItem());
  assert.equal(result.ready, true);
  assert.deepEqual(result.errors, []);
});

test("blocks a sourcing product until every sourced option is received", () => {
  const item = completeItem({
    source: { system: "commerce-os-sourcing-engine" },
    orderOptions: [
      {
        optionName: "색상",
        saleOption: "화이트",
        barcode: "BZZ1-1",
        optionBarcodeNo: "000000009001",
        baseSalePriceKrw: 5000,
        unitCostKrw: 1000,
        sourcingIntakeId: "22222222-2222-4222-8222-222222222222",
        lifecycleStatus: "RECEIVED",
        receiptId: "11111111-1111-4111-8111-111111111111",
      },
      {
        optionName: "색상",
        saleOption: "블랙",
        barcode: "BZZ1-2",
        optionBarcodeNo: "000000009002",
        baseSalePriceKrw: 5000,
        unitCostKrw: 1000,
        sourcingIntakeId: "33333333-3333-4333-8333-333333333333",
        lifecycleStatus: "RESERVED",
      },
    ],
  });
  const result = productLaunchSeoMaterialReadiness(item);
  assert.equal(sourcingReceiptStatus(item), "pending");
  assert.equal(result.ready, false);
  assert.equal(result.receiptPending, true);
  assert.match(result.errors[0], /입고확정/);
});

test("checks option barcode numbers used by the real Shopling payload", () => {
  const item = completeItem();
  item.orderOptions[0].optionBarcodeNo = "123";
  const result = productLaunchSeoMaterialReadiness(item);
  assert.equal(result.ready, false);
  assert.match(result.errors.join("\n"), /숫자 12자리/);
});

test("does not trust a RECEIVED label without a receipt id", () => {
  const item = completeItem({
    source: { system: "commerce-os-sourcing-engine" },
    orderOptions: [
      {
        ...completeItem().orderOptions[0],
        sourcingIntakeId: "44444444-4444-4444-8444-444444444444",
        lifecycleStatus: "RECEIVED",
        receiptId: null,
      },
    ],
  });

  assert.equal(sourcingReceiptStatus(item), "pending");
  assert.equal(productLaunchSeoMaterialReadiness(item).ready, false);
});

test("blocks duplicate option identities unless an audited product policy allows sharing", () => {
  const duplicateOptions = [
    completeItem().orderOptions[0],
    {
      ...completeItem().orderOptions[0],
      saleOption: "블랙",
    },
  ];

  const blocked = productLaunchSeoMaterialReadiness(
    completeItem({ orderOptions: duplicateOptions }),
  );
  assert.equal(blocked.ready, false);
  assert.match(blocked.errors.join("\n"), /B코드 .*중복/);
  assert.match(blocked.errors.join("\n"), /옵션바코드NO .*중복/);

  const allowed = productLaunchSeoMaterialReadiness(
    completeItem({
      orderOptions: duplicateOptions,
      seoMaterialPolicy: {
        allowSharedOptionIdentity: true,
        source: "owner_confirmed_shared_physical_bcode",
      },
    }),
  );
  assert.equal(allowed.ready, true);
  assert.deepEqual(allowed.errors, []);
});
