import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildProductMasterSnapshotFromTrackerState,
  inferUnitsPerOrder,
} from "../src/lib/productMasterSync.ts";
import {
  buildCanonicalProductMasterSnapshot,
  findCanonicalProductMasterBarcodeConflicts,
} from "../src/lib/productMasterCanonicalSync.ts";

test("converts launch tracker products, SKU barcodes and Shopling mappings", () => {
  const result = buildProductMasterSnapshotFromTrackerState({
    items: [
      {
        modelNumber: "AAA001",
        productName: "테스트 상품",
        shoplingCategory: "생활 > 정리",
        notes: "기준 상품",
        chinaProductLinks: ["https://detail.1688.com/offer/1.html"],
        detailPageAsset: {
          mainImageUrl: "https://example.com/main.jpg",
        },
        orderOptions: [
          {
            id: "option-1",
            saleOption: "블랙 5개 세트",
            chinaOption: "黑色",
            barcode: "BAA1-1",
          },
        ],
        shoplingProducts: {
          wholesale1: {
            goodsKey: "121001",
            registeredAt: "2026-08-01T00:00:00.000Z",
          },
        },
        stages: {
          detailPage: { status: "완료" },
          priceKeyword: { status: "완료" },
          shoplingUpload: { status: "완료" },
          marketRegistration: { status: "완료" },
          orderMapping: { status: "완료" },
          inventoryReflection: { status: "완료" },
        },
      },
    ],
    priceAdjustmentReceiptCache: {
      receiptsByBarcode: {
        "BAA1-1": [
          {
            id: "receipt-1",
            barcode: "BAA1-1",
            quantity: 100,
            unitCostKrw: 2500,
            receivedAt: "2026-07-31T00:00:00.000Z",
          },
        ],
      },
    },
  });

  assert.equal(result.payload.products.length, 1);
  assert.equal(result.payload.products[0].status, "ACTIVE");
  assert.equal(result.payload.skus.length, 1);
  assert.equal(result.payload.skus[0].barcode, "BAA1-1");
  assert.equal(result.payload.skus[0].supplierUrl, "https://detail.1688.com/offer/1.html");
  assert.equal(result.payload.listingMappings.length, 1);
  assert.equal(result.payload.listingMappings[0].goodsKey, "121001");
  assert.equal(result.payload.listingMappings[0].unitsPerOrder, 5);
  assert.equal(result.payload.receiptCosts.length, 1);
  assert.equal(result.payload.receiptCosts[0].unitCostKrw, 2500);
  assert.deepEqual(result.payload.inventoryMovements, []);
});

test("does not mistake dimensions for bundle quantities", () => {
  assert.equal(inferUnitsPerOrder("블랙 20mm"), 1);
  assert.equal(inferUnitsPerOrder("8x8cm"), 1);
  assert.equal(inferUnitsPerOrder("10개 묶음"), 10);
  assert.equal(inferUnitsPerOrder("단품"), 1);
});

test("allows explicitly approved shared physical B-codes and blocks unapproved conflicts", () => {
  const items = [
    {
      id: "item-a",
      modelNumber: "AAA001",
      productName: "과거 판매명 A",
      orderOptions: [
        { id: "option-a", barcode: "BAA1-1", saleOption: "랜덤" },
      ],
    },
    {
      id: "item-b",
      modelNumber: "AAA002",
      productName: "과거 판매명 B",
      orderOptions: [
        { id: "option-b", barcode: "BAA1-1", saleOption: "현재 실물" },
      ],
    },
  ];

  assert.throws(
    () => buildCanonicalProductMasterSnapshot({ items }),
    /TRACKER_BARCODE_CONFLICT:BAA1-1/,
  );

  const result = buildCanonicalProductMasterSnapshot({
    skuIdentityPolicy: {
      sharedBarcodes: {
        "BAA1-1": {
          identity: "approved-physical-sku-1",
          classification: "A",
        },
      },
    },
    items,
  });

  assert.equal(result.payload.skus.length, 1);
  assert.equal(
    result.payload.skus[0].sourceSkuKey,
    "shared-physical:approved-physical-sku-1",
  );
});

test("identifies every item that must be skipped when a B-code conflicts", () => {
  const conflicts = findCanonicalProductMasterBarcodeConflicts({
    items: [
      {
        id: "same-item",
        modelNumber: "AAA206",
        orderOptions: [
          { id: "beige", barcode: "BBB6-2", saleOption: "베이지" },
          { id: "gray", barcode: "BBB6-2", saleOption: "그레이" },
        ],
      },
      {
        id: "safe-item",
        modelNumber: "AAA426",
        orderOptions: [
          { id: "single", barcode: "BBA6-1", saleOption: "단품" },
        ],
      },
    ],
  });

  assert.deepEqual(conflicts, [
    {
      barcode: "BBB6-2",
      itemIds: ["same-item"],
      sourceSkuKeys: ["same-item:beige", "same-item:gray"],
    },
  ]);
});

test("exposes a guarded canonical sync control and redirects the legacy page", async () => {
  const [endpoint, canonical, button, page, legacy] = await Promise.all([
    readFile(
      new URL(
        "../src/app/api/product-launch-tracker/product-master-sync/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../src/lib/productMasterCanonicalSync.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/components/product-launch-flow/ProductMasterSyncButton.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../src/app/product-launch-tracker/page.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/app/product-master/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(endpoint, /resolveProductLaunchIdentity/);
  assert.match(endpoint, /readProductLaunchState/);
  assert.match(endpoint, /pushCanonicalProductMasterSnapshotFromTrackerState/);
  assert.match(canonical, /sourceSkuKey/);
  assert.match(canonical, /sharedBarcodes/);
  assert.match(canonical, /sku-source:/);
  assert.match(canonical, /api\/integrations\/canonical-snapshot/);
  assert.match(canonical, /TRACKER_BARCODE_CONFLICT/);
  assert.match(button, /상품마스터 동기화/);
  assert.match(button, /credentials: "same-origin"/);
  assert.match(page, /ProductMasterSyncButton/);
  assert.match(legacy, /commerce-os-product-master\.vercel\.app/);
});
