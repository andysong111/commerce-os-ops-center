import assert from "node:assert/strict";
import test from "node:test";
import { resolveLegacySeoProductMasterOptionAuthority } from "../src/lib/legacySeoProductMasterOptionAuthority.ts";

function product(overrides = {}) {
  return {
    productId: "product-1",
    modelNo: "AAA418",
    productName: "무타공 흡착식 후크",
    productNameCn: "",
    category: "",
    status: "ACTIVE",
    mainImageUrl: "",
    origin: "MADE IN CHINA",
    memo: "",
    skus: [
      {
        skuId: "sku-red",
        barcode: "BBG6-1",
        optionName: "레드",
        chinaOptionName: "红色",
        optionImageUrl: "",
        supplierUrl: "",
        active: true,
        optionBarcodeNo: "123456789012",
        optionBarcodeIdentityKey: "B:BBG6-1",
        latestCostKrw: 800,
        currentBasePrice: 4900,
        listings: [],
      },
      {
        skuId: "sku-blue",
        barcode: "BBG7-1",
        optionName: "블루",
        chinaOptionName: "蓝色",
        optionImageUrl: "",
        supplierUrl: "",
        active: true,
        optionBarcodeNo: "OB123456789013",
        optionBarcodeIdentityKey: "B:BBG7-1",
        latestCostKrw: 900,
        currentBasePrice: 5900,
        listings: [],
      },
    ],
    ...overrides,
  };
}

test("complete active Product Master SKU set becomes exact registration options", () => {
  const result = resolveLegacySeoProductMasterOptionAuthority({
    currentOptions: [
      {
        id: "existing-red",
        saleOption: "과거 레드",
        barcode: "OLD-1",
        optionBarcodeNo: "123456789012",
        customMetadata: "preserved",
      },
    ],
    product: product(),
    syncedAt: "2026-10-14T00:00:00.000Z",
  });

  assert.equal(result.confirmed, true);
  assert.deepEqual(
    result.options.map((option) => [option.id, option.saleOption, option.barcode]),
    [
      ["existing-red", "레드", "BBG6-1"],
      ["product-master-aaa418-2", "블루", "BBG7-1"],
    ],
  );
  assert.equal(result.options[0].customMetadata, "preserved");
  assert.equal(
    result.options[0].productMasterOptionAuthority.source,
    "product_master_inventory_catalog",
  );
});

test("missing managed B-code keeps Product Master fallback fail-closed", () => {
  const invalid = product();
  invalid.skus[1].barcode = "미배정";
  const result = resolveLegacySeoProductMasterOptionAuthority({
    currentOptions: [],
    product: invalid,
    syncedAt: "2026-10-14T00:00:00.000Z",
  });

  assert.equal(result.confirmed, false);
  assert.match(result.reason, /B코드 없음/);
  assert.deepEqual(result.options, []);
});

test("duplicate Product Master option identity is rejected", () => {
  const invalid = product();
  invalid.skus[1].optionBarcodeIdentityKey = "B:BBG6-1";
  const result = resolveLegacySeoProductMasterOptionAuthority({
    currentOptions: [],
    product: invalid,
    syncedAt: "2026-10-14T00:00:00.000Z",
  });

  assert.equal(result.confirmed, false);
  assert.match(result.reason, /식별값 중복/);
});
