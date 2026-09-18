import assert from "node:assert/strict";
import test from "node:test";
import {
  applyProductLaunchTrackerMutation,
  buildProductLaunchTrackerIndex,
  getProductLaunchTrackerItem,
  queryProductLaunchTrackerPage,
  summarizeProductLaunchTrackerItem,
} from "../src/lib/productLaunchTrackerOptimized.ts";

const stageKeys = [
  "detailPage",
  "priceKeyword",
  "shoplingUpload",
  "marketRegistration",
  "orderMapping",
  "inventoryReflection",
];

function item(index, overrides = {}) {
  const stages = Object.fromEntries(
    stageKeys.map((key) => [key, { status: "미시작", assignee: index % 2 ? "승준" : "경주" }]),
  );
  return {
    id: `item-${index}`,
    trackerRowNumber: index,
    workBatch: index <= 60 ? "A 묶음" : "B 묶음",
    warehouseLocation: `B${index}`,
    barcode: `BAA${index}-1`,
    modelNumber: `AAA${String(index).padStart(3, "0")}`,
    productName: `테스트 상품 ${index}`,
    shoplingCategory: "생활>정리",
    selfCodeBase: `PL${String(index).padStart(8, "0")}`,
    notes: index === 73 ? "정확 검색 토큰" : "",
    orderOptions: [
      {
        id: `option-${index}`,
        optionName: "옵션",
        saleOption: "단품",
        barcode: `BAA${index}-1`,
        baseSalePriceKrw: 1000,
        unitCostKrw: 400,
      },
    ],
    detailPageAsset: {
      html: `<p>${"상세".repeat(500)}</p>`,
      mainImageUrl: "https://example.test/main.jpg",
      additionalImageUrls: [],
    },
    stages,
    createdAt: `2026-08-01T00:${String(index % 60).padStart(2, "0")}:00.000Z`,
    updatedAt: `2026-08-05T00:${String(index % 60).padStart(2, "0")}:00.000Z`,
    updatedBy: "승준",
    ...overrides,
  };
}

function state(count = 123) {
  return {
    schemaVersion: 3,
    savedAt: "2026-08-05T00:00:00.000Z",
    policy: { version: 1 },
    items: Array.from({ length: count }, (_, index) => item(index + 1)),
  };
}

test("server page query returns only the requested 50-row window", () => {
  const index = buildProductLaunchTrackerIndex(state());
  const page = queryProductLaunchTrackerPage(index, {
    page: 2,
    pageSize: 50,
    unfinishedOnly: false,
  });
  assert.equal(page.page, 2);
  assert.equal(page.pageSize, 50);
  assert.equal(page.pageCount, 3);
  assert.equal(page.total, 123);
  assert.equal(page.items.length, 50);
  assert.ok(page.items.every((entry) => !("searchText" in entry)));
});

test("server filters and search run before paging", () => {
  const source = state();
  source.items[72].stages.detailPage.status = "완료";
  const index = buildProductLaunchTrackerIndex(source);
  const byBatch = queryProductLaunchTrackerPage(index, {
    page: 1,
    pageSize: 100,
    batch: "A 묶음",
    unfinishedOnly: false,
  });
  assert.equal(byBatch.total, 60);

  const search = queryProductLaunchTrackerPage(index, {
    page: 1,
    pageSize: 50,
    search: "정확 검색 토큰",
    unfinishedOnly: false,
  });
  assert.equal(search.total, 1);
  assert.equal(search.items[0].id, "item-73");
});

test("an active filter with no matching index key returns zero rows", () => {
  const index = buildProductLaunchTrackerIndex(state(5));
  const page = queryProductLaunchTrackerPage(index, {
    page: 1,
    pageSize: 50,
    overall: "완료",
    unfinishedOnly: false,
  });
  assert.equal(page.total, 0);
  assert.equal(page.items.length, 0);
});

test("list summary excludes heavy detail HTML while lazy item keeps it", () => {
  const source = state(1);
  const index = buildProductLaunchTrackerIndex(source);
  const summary = summarizeProductLaunchTrackerItem(source.items[0]);
  assert.equal(summary.detailPageAsset.html, undefined);
  const full = getProductLaunchTrackerItem(index, "item-1");
  assert.match(full.detailPageAsset.html, /상세/);
});

test("item patch changes only the targeted item and preserves unrelated records", () => {
  const source = state(3);
  const before = structuredClone(source.items[1]);
  const mutation = applyProductLaunchTrackerMutation(source, {
    operation: "patch_item",
    itemId: "item-1",
    patch: { productName: "수정 상품" },
  });
  assert.equal(mutation.state.items[0].productName, "수정 상품");
  assert.deepEqual(mutation.state.items[1], before);
  assert.deepEqual(mutation.changedIds, ["item-1"]);
});

test("bulk item patch applies multiple scoped changes in one state mutation", () => {
  const source = state(4);
  const untouched = structuredClone(source.items[1]);
  const mutation = applyProductLaunchTrackerMutation(source, {
    operation: "bulk_patch_items",
    patches: [
      {
        itemId: "item-1",
        patch: {
          categoryAiSuggestion: "생활>욕실>샤워기",
          categoryAiStatus: "review_required",
        },
      },
      {
        itemId: "item-3",
        patch: {
          categoryAiSuggestion: "생활>청소>브러시",
          categoryAiStatus: "review_required",
        },
      },
    ],
    updatedBy: "승준 · AI 카테고리 후보 생성",
  });

  assert.equal(mutation.state.items[0].categoryAiSuggestion, "생활>욕실>샤워기");
  assert.equal(mutation.state.items[2].categoryAiSuggestion, "생활>청소>브러시");
  assert.deepEqual(mutation.state.items[1], untouched);
  assert.deepEqual(mutation.changedIds, ["item-1", "item-3"]);
  assert.equal(mutation.state.items[0].updatedBy, "승준 · AI 카테고리 후보 생성");
});

test("bulk item patch rejects duplicate item IDs before a state write", () => {
  assert.throws(
    () =>
      applyProductLaunchTrackerMutation(state(2), {
        operation: "bulk_patch_items",
        patches: [
          { itemId: "item-1", patch: { categoryAiStatus: "review_required" } },
          { itemId: "item-1", patch: { categoryAiStatus: "review_approved" } },
        ],
      }),
    /중복/,
  );
});

test("option-label edits preserve option barcode and prices", () => {
  const source = state(1);
  source.items[0].orderOptions = [
    { id: "a", saleOption: "블랙", barcode: "BAA1-1", baseSalePriceKrw: 1000, unitCostKrw: 400 },
    { id: "b", saleOption: "화이트", barcode: "BAA1-2", baseSalePriceKrw: 1200, unitCostKrw: 450 },
  ];
  const mutation = applyProductLaunchTrackerMutation(source, {
    operation: "patch_item",
    itemId: "item-1",
    patch: { optionLabels: ["검정", "흰색"] },
  });
  const options = mutation.state.items[0].orderOptions;
  assert.deepEqual(options.map((option) => option.saleOption), ["검정", "흰색"]);
  assert.deepEqual(options.map((option) => option.barcode), ["BAA1-1", "BAA1-2"]);
  assert.deepEqual(options.map((option) => option.baseSalePriceKrw), [1000, 1200]);
});

test("single-option products keep the option barcode aligned with the main barcode", () => {
  const source = state(1);
  const mutation = applyProductLaunchTrackerMutation(source, {
    operation: "patch_item",
    itemId: "item-1",
    patch: { barcode: "BZZ9-9", optionLabels: ["단품"] },
  });
  assert.equal(mutation.state.items[0].barcode, "BZZ9-9");
  assert.equal(mutation.state.items[0].orderOptions[0].barcode, "BZZ9-9");
});

test("bulk stage mutation updates the selected IDs in one state write", () => {
  const source = state(5);
  const mutation = applyProductLaunchTrackerMutation(source, {
    operation: "bulk_stage",
    itemIds: ["item-1", "item-3"],
    stageKey: "detailPage",
    status: "완료",
  });
  assert.equal(mutation.state.items[0].stages.detailPage.status, "완료");
  assert.equal(mutation.state.items[2].stages.detailPage.status, "완료");
  assert.equal(mutation.state.items[1].stages.detailPage.status, "미시작");
});


test("list summary preserves canonical China product links for partial-page cache", () => {
  const source = state(1);
  source.items[0].chinaProductLinks = [
    "https://detail.1688.com/offer/904143560486.html",
  ];
  let summary = summarizeProductLaunchTrackerItem(source.items[0]);
  assert.deepEqual(summary.chinaProductLinks, [
    "https://detail.1688.com/offer/904143560486.html",
  ]);

  source.items[0].chinaProductLinks = [];
  source.items[0].primaryChinaProductLink =
    "https://detail.1688.com/offer/111.html";
  source.items[0].detailPageSource = {
    primaryUrl: "https://detail.1688.com/offer/111.html",
    urls: [
      "https://detail.1688.com/offer/111.html",
      "https://detail.1688.com/offer/222.html",
    ],
  };
  summary = summarizeProductLaunchTrackerItem(source.items[0]);
  assert.deepEqual(summary.chinaProductLinks, [
    "https://detail.1688.com/offer/111.html",
    "https://detail.1688.com/offer/222.html",
  ]);
});
