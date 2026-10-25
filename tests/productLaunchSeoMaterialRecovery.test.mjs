import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildProductLaunchSeoMaterialRecoveryPlan,
  productLaunchSeoRecoveryNeedsShoplingEvidence,
} from "../src/lib/productLaunchSeoMaterialRecovery.ts";
import { extractLegacySeoDetailImageUrls } from "../src/lib/legacySeoShoplingDetailImages.ts";

function item(overrides = {}) {
  return {
    id: "item-1",
    modelNumber: "AAA900",
    productName: "테스트 상품",
    shoplingCategory: "생활용품>수납",
    selfCodeBase: "AAA900",
    detailPageAsset: {
      html: "<p>상세</p>",
      mainImageUrl: "https://example.com/current.jpg",
    },
    orderOptions: [
      {
        id: "current-option-1",
        optionName: "옵션",
        saleOption: "화이트",
        barcode: "",
        optionBarcodeNo: "",
        baseSalePriceKrw: 0,
        unitCostKrw: 0,
      },
    ],
    ...overrides,
  };
}

function product(overrides = {}) {
  return {
    productId: "product:AAA900",
    modelNo: "AAA900",
    productName: "테스트 상품",
    productNameCn: "",
    category: "생활용품>수납",
    status: "ACTIVE",
    mainImageUrl: "https://example.com/master.jpg",
    origin: "MADE IN CHINA",
    memo: "",
    skus: [
      {
        skuId: "sku-1",
        barcode: "BAA1-1",
        optionName: "화이트",
        chinaOptionName: "白色",
        optionImageUrl: "",
        supplierUrl: "",
        active: true,
        optionBarcodeNo: "123456789012",
        optionBarcodeIdentityKey: "B:BAA1-1",
        latestCostKrw: 5000,
        currentBasePrice: 12000,
        listings: [],
      },
    ],
    ...overrides,
  };
}

function evidence(overrides = {}) {
  return {
    modelNumber: "AAA900",
    goodsKeys: ["123456"],
    titles: ["테스트 상품"],
    searchKeywords: [],
    categories: ["생활용품>수납"],
    optionNames: ["화이트"],
    optionGroups: [
      {
        goodsKey: "123456",
        ptnGoodsCd: "AAA900",
        productName: "테스트 상품",
        saleStatus: "Y",
        originalPrice: "",
        salePrice: "",
        listPrice: "",
        originName: "",
        detailHtml: "<p>샵플링 상세</p>",
        imageUrls: ["https://example.com/shopling.jpg"],
        options: [
          {
            optionName: "화이트",
            optionId: "1",
            bCode: "BAA1-1",
            optionBarcode: "123456789012",
            status: "Y",
            quantity: "1",
            amount: "0",
          },
        ],
      },
    ],
    fetchedRowCount: 1,
    source: "shopling_live_api",
    ...overrides,
  };
}

test("SEO material recovery fills only exact Product Master option authority", () => {
  const plan = buildProductLaunchSeoMaterialRecoveryPlan({
    item: item(),
    product: product(),
    recoveredAt: "2026-10-25T00:00:00.000Z",
  });

  assert.equal(plan.status, "ready_after_recovery");
  assert.deepEqual(plan.changedFields, ["orderOptions"]);
  assert.equal(plan.patch.orderOptions[0].id, "current-option-1");
  assert.equal(plan.patch.orderOptions[0].barcode, "BAA1-1");
  assert.equal(plan.patch.orderOptions[0].optionBarcodeNo, "123456789012");
  assert.equal(plan.patch.orderOptions[0].baseSalePriceKrw, 12000);
  assert.equal(plan.patch.orderOptions[0].unitCostKrw, 5000);
  assert.deepEqual(plan.afterErrors, []);
});

test("an empty option list needs Shopling parity or an exact single row B-code", () => {
  const withoutEvidence = buildProductLaunchSeoMaterialRecoveryPlan({
    item: item({ orderOptions: [] }),
    product: product(),
  });
  assert.equal(withoutEvidence.status, "unresolved");
  assert.equal("orderOptions" in withoutEvidence.patch, false);
  assert.match(withoutEvidence.unresolved.join("\n"), /Shopling B코드/);

  const confirmed = buildProductLaunchSeoMaterialRecoveryPlan({
    item: item({ orderOptions: [] }),
    product: product(),
    evidence: evidence(),
  });
  assert.equal(confirmed.status, "ready_after_recovery");
  assert.equal(confirmed.patch.orderOptions[0].barcode, "BAA1-1");

  const rowConfirmed = buildProductLaunchSeoMaterialRecoveryPlan({
    item: item({ orderOptions: [], selfCodeBase: "BAA1-1" }),
    product: product(),
  });
  assert.equal(rowConfirmed.status, "ready_after_recovery");
  assert.equal(rowConfirmed.patch.orderOptions[0].barcode, "BAA1-1");
  assert.equal(
    productLaunchSeoRecoveryNeedsShoplingEvidence(
      item({ orderOptions: [], selfCodeBase: "BAA1-1" }),
      product(),
    ),
    false,
  );
});

test("a known warehouse-location conflict stays blocked for physical confirmation", () => {
  const plan = buildProductLaunchSeoMaterialRecoveryPlan({
    item: item({ modelNumber: "AAA480", orderOptions: [], selfCodeBase: "BEF1-1" }),
    product: product({
      modelNo: "AAA480",
      skus: [{ ...product().skus[0], barcode: "BEF1-1" }],
    }),
  });
  assert.equal(plan.status, "unresolved");
  assert.equal("orderOptions" in plan.patch, false);
  assert.match(plan.unresolved.join("\n"), /실제 창고 위치/);
});

test("option count or identity mismatch never overwrites current options", () => {
  const current = item({
    orderOptions: [
      { id: "one", saleOption: "화이트" },
      { id: "two", saleOption: "블랙" },
    ],
  });
  const plan = buildProductLaunchSeoMaterialRecoveryPlan({
    item: current,
    product: product(),
  });
  assert.equal(plan.status, "unresolved");
  assert.equal("orderOptions" in plan.patch, false);
  assert.match(plan.unresolved.join("\n"), /1:1/);
});

test("duplicate current B-codes are repaired only when unique option names match Product Master", () => {
  const current = item({
    orderOptions: [
      {
        id: "white",
        saleOption: "화이트",
        barcode: "BAA1-1",
        optionBarcodeNo: "123456789012",
        baseSalePriceKrw: 0,
      },
      {
        id: "black",
        saleOption: "블랙",
        barcode: "BAA1-1",
        optionBarcodeNo: "123456789012",
        baseSalePriceKrw: 0,
      },
    ],
  });
  const master = product({
    skus: [
      product().skus[0],
      {
        ...product().skus[0],
        skuId: "sku-2",
        barcode: "BAA1-2",
        optionName: "블랙",
        optionBarcodeNo: "123456789013",
        optionBarcodeIdentityKey: "B:BAA1-2",
      },
    ],
  });
  const plan = buildProductLaunchSeoMaterialRecoveryPlan({ item: current, product: master });
  assert.equal(plan.status, "ready_after_recovery");
  assert.deepEqual(
    plan.patch.orderOptions.map((option) => [option.id, option.saleOption, option.barcode]),
    [
      ["white", "화이트", "BAA1-1"],
      ["black", "블랙", "BAA1-2"],
    ],
  );
});

test("sold-out exclusions and sourcing receipt-pending items are never auto-recovered", () => {
  const excluded = buildProductLaunchSeoMaterialRecoveryPlan({
    item: item({
      legacySeoRegistrationPolicy: {
        excluded: true,
        status: "sold_out",
        reason: "사용자 품절 제외",
      },
    }),
    product: product(),
  });
  assert.equal(excluded.status, "excluded");
  assert.equal(excluded.changed, false);

  const pending = buildProductLaunchSeoMaterialRecoveryPlan({
    item: item({
      source: { system: "commerce-os-sourcing-engine", lifecycleStatus: "RESERVED" },
    }),
    product: product(),
  });
  assert.equal(pending.status, "receipt_pending");
  assert.equal(pending.changed, false);
});

test("missing detail assets are filled without replacing an existing main image", () => {
  const plan = buildProductLaunchSeoMaterialRecoveryPlan({
    item: item({
      detailPageAsset: { mainImageUrl: "https://example.com/current.jpg" },
    }),
    product: product(),
    evidence: evidence(),
  });
  assert.equal(plan.patch.detailPageAsset.html, "<p>샵플링 상세</p>");
  assert.equal(
    plan.patch.detailPageAsset.mainImageUrl,
    "https://example.com/current.jpg",
  );
});

test("Shopling detail HTML supplies static images before animated images", () => {
  assert.deepEqual(
    extractLegacySeoDetailImageUrls(
      '<div><img src="https://example.com/intro.gif"><img data-src="https://example.com/main.jpg?x=1&amp;y=2"></div>',
    ),
    [
      "https://example.com/main.jpg?x=1&y=2",
      "https://example.com/intro.gif",
    ],
  );
});

test("a matching Shopling model name selects the right category and detail image", () => {
  const plan = buildProductLaunchSeoMaterialRecoveryPlan({
    item: item({
      productName: "풋브러쉬 색상랜덤",
      shoplingCategory: "",
      detailPageAsset: {},
    }),
    product: product({ mainImageUrl: "", category: "" }),
    evidence: evidence({
      categories: ["뷰티>풋케어", "생활>샤워타월"],
      optionGroups: [
        {
          ...evidence().optionGroups[0],
          goodsKey: "100001",
          productName: "실리콘 풋브러쉬",
          modelName: "풋브러쉬",
          category: "뷰티>풋케어",
          detailHtml: '<img src="https://example.com/foot.jpg">',
          imageUrls: ["https://example.com/foot.jpg"],
        },
        {
          ...evidence().optionGroups[0],
          goodsKey: "100002",
          productName: "실리콘 등브러쉬",
          modelName: "등브러쉬 색상랜덤",
          category: "생활>샤워타월",
          detailHtml: '<img src="https://example.com/back.jpg">',
          imageUrls: ["https://example.com/back.jpg"],
        },
      ],
    }),
  });
  assert.equal(plan.patch.shoplingCategory, "뷰티>풋케어");
  assert.equal(plan.patch.detailPageAsset.mainImageUrl, "https://example.com/foot.jpg");
});

test("recovery API requires a matching preview hash and delegates an atomic bulk patch", async () => {
  const route = await readFile(
    "src/app/api/product-launch-tracker/seo-material-recovery/route.ts",
    "utf8",
  );
  const tracker = await readFile("src/lib/productLaunchTrackerOptimized.ts", "utf8");
  const inventoryCatalog = await readFile(
    "src/lib/legacySeoInventoryCatalog.ts",
    "utf8",
  );
  const seoRunRoute = await readFile("src/app/api/seo-run-jobs/route.ts", "utf8");
  assert.match(route, /expectedPlanHash !== prepared\.report\.planHash/);
  assert.match(route, /operation: "bulk_patch_items"/);
  assert.match(route, /expectedUpdatedAt/);
  assert.match(tracker, /미리보기 뒤 동시에 수정되었습니다/);
  assert.match(seoRunRoute, /legacySeoRegistrationExclusion\(item\)/);
  assert.match(
    route,
    /recoveryItems\.map\(\(item\) => normalizeLegacyModel\(item\.modelNumber\)\)/,
  );
  assert.match(route, /readProductLaunchNormalizedItemsByModelNumbers/);
  assert.match(route, /workspace\?\.normalized_read_enabled === true/);
  assert.match(route, /itemSource: useNormalizedExactRead \? "normalized-exact" : "legacy-state"/);
  assert.match(inventoryCatalog, /searchParams\.set\("modelNumbers"/);
  assert.match(inventoryCatalog, /AbortSignal\.timeout\(90_000\)/);
  assert.match(route, /const recoveredAt = sourceStateUpdatedAt/);
  assert.doesNotMatch(route, /const recoveredAt = new Date\(\)\.toISOString\(\)/);
  assert.match(route, /filter\(\(item\) => !productLaunchSeoMaterialReadiness\(item\)\.ready\)/);
  assert.match(route, /loadLegacySeoInventoryCatalog\(recoveryModels\)/);
  assert.match(route, /runRecoveryStage\("inventory-catalog"/);
  assert.match(route, /runRecoveryStage\("shopling-evidence"/);
});

test("legacy option sync keeps Product Master reads inside the requested models", async () => {
  const source = await readFile(
    "src/lib/legacySeoShoplingOptionSync.ts",
    "utf8",
  );
  assert.match(source, /loadLegacySeoInventoryCatalog\(requested\)/);
  assert.doesNotMatch(source, /loadLegacySeoInventoryCatalog\(\)/);
});

test("Shopling evidence skips the full planning snapshot when exact goods keys exist", async () => {
  const source = await readFile(
    "src/lib/legacySeoShoplingEvidence.ts",
    "utf8",
  );
  assert.match(source, /hasCompleteOverrideMapping/);
  assert.match(source, /if \(!hasCompleteOverrideMapping\)/);
  assert.match(source, /await loadProductPlanningSnapshot\(\)/);
});
