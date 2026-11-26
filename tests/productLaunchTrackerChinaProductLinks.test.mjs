import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  addChinaPurchaseAlternate,
  chinaLinkUsagePatch,
  readChinaDetailPageLink,
  readChinaLinkUsage,
  readChinaPurchaseLink,
  readLegacyChinaLinkUsage,
  setChinaLinkUsageInput,
  applyChinaProductLinks,
  MAX_CHINA_PRODUCT_LINKS,
  normalizeChinaProductLinks,
  promoteChinaProductLink,
  readChinaProductLinks,
  sameChinaProductLinks,
} from "../public/product-launch-tracker-app/lib/china-product-links.mjs";

test("발주용 링크 후순위는 클릭당 하나씩 추가되고 기존 순서와 최대 5순위를 지킨다", () => {
  const common = "https://detail.1688.com/offer/100.html";
  const second = "https://detail.1688.com/offer/200.html";
  const third = "https://detail.1688.com/offer/300.html";
  const fourth = "https://detail.1688.com/offer/400.html";
  const existing = readChinaLinkUsage({ chinaProductLinks: [common, second] });
  const added = addChinaPurchaseAlternate(existing);
  assert.deepEqual(added.purchaseAlternates, [second, ""]);
  assert.deepEqual(existing.purchaseAlternates, [second]);
  assert.deepEqual(chinaLinkUsagePatch({}, added).chinaLinkUsage, existing);

  const full = addChinaPurchaseAlternate({ ...added, purchaseAlternates: [second, third, fourth] });
  assert.deepEqual(full.purchaseAlternates, [second, third, fourth, ""]);
  assert.equal(addChinaPurchaseAlternate(full), full);
  assert.equal(readChinaPurchaseLink({ chinaLinkUsage: full }), common);
});

test("상품 상세 두 편집기는 저장된 발주 순위만 표시하고 후순위 추가 버튼을 연결한다", async () => {
  const [standalone, optimized] = await Promise.all([
    readFile(new URL("../src/app/product-launch-editor/ProductLaunchStandaloneEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/product-launch-tracker-app/optimized-app.js", import.meta.url), "utf8"),
  ]);
  for (const source of [standalone, optimized]) {
    assert.match(source, /발주용 링크 1순위/);
    assert.match(source, /발주용 링크 후순위 추가/);
    assert.match(source, /purchaseAlternates\.map\(/);
    assert.match(source, /addChinaPurchaseAlternate\(usage\)|addChinaPurchaseAlternate\(value\)/);
    assert.doesNotMatch(source, /추가 발주 후보 링크/);
  }
});

test("기존 1번 링크는 공통으로 사용하고 나머지는 발주 후보 순서로 보존한다", () => {
  const one = "https://detail.1688.com/offer/100.html";
  const two = "https://detail.1688.com/offer/200.html";
  const three = "https://detail.1688.com/offer/300.html";
  const legacy = { chinaProductLinks: [one, two, three], primaryChinaProductLink: two };
  assert.deepEqual(readLegacyChinaLinkUsage(legacy), {
    commonUrl: one, purchaseUrl: "", detailPageUrl: "", purchaseAlternates: [two, three],
  });
  assert.equal(readChinaPurchaseLink(legacy), one);
  assert.equal(readChinaDetailPageLink(legacy), one);
  assert.deepEqual(readChinaLinkUsage({ chinaProductLinks: [one] }).purchaseAlternates, []);
  assert.equal(readLegacyChinaLinkUsage({ chinaProductLinks: ["v", one] }).commonUrl, one);
  assert.equal(readLegacyChinaLinkUsage({ chinaProductLinks: ["ᄆ"] }).commonUrl, "");
  assert.throws(() => readLegacyChinaLinkUsage({ chinaProductLinks: [one, "invalid"] }));
});

test("용도별 값을 처음 입력하면 다른 용도에는 공통 링크를 복사하고, 이후에는 독립적으로 읽는다", () => {
  const common = "https://detail.1688.com/offer/100.html";
  const purchase = "https://detail.1688.com/offer/200.html";
  const detail = "https://detail.1688.com/offer/300.html";
  const base = readChinaLinkUsage({ chinaProductLinks: [common, purchase] });
  const split = setChinaLinkUsageInput(base, "detailPageUrl", detail);
  assert.equal(split.purchaseUrl, common);
  const patched = chinaLinkUsagePatch({ detailPageSource: { resultId: "saved" } }, { ...split, purchaseUrl: purchase });
  assert.deepEqual(patched.chinaProductLinks, [purchase]);
  assert.equal(patched.detailPageSource.primaryUrl, detail);
  assert.equal(patched.detailPageSource.resultId, "saved");
  assert.equal(readChinaPurchaseLink(patched), purchase);
  assert.equal(readChinaDetailPageLink(patched), detail);

  const detailOnly = chinaLinkUsagePatch({}, { ...split, purchaseUrl: "" });
  assert.equal(readChinaPurchaseLink(detailOnly), "");
  assert.deepEqual(detailOnly.chinaProductLinks, []);
  assert.deepEqual(detailOnly.chinaLinkUsage.purchaseAlternates, [purchase]);
  assert.equal(readChinaDetailPageLink(detailOnly), detail);
});
import {
  applyChinaOrderOptionMappings,
  readChinaOrderOptionMappings,
  sameChinaOrderOptionMappings,
} from "../public/product-launch-tracker-app/lib/china-order-options.mjs";

test("중국 상품링크는 최대 5개로 정규화하고 중복을 제거한다", () => {
  const links = normalizeChinaProductLinks([
    "detail.1688.com/offer/1.html",
    "https://detail.1688.com/offer/1.html",
    "https://detail.1688.com/offer/2.html",
    "https://detail.1688.com/offer/3.html",
    "https://detail.1688.com/offer/4.html",
    "https://detail.1688.com/offer/5.html",
    "https://detail.1688.com/offer/6.html",
  ]);
  assert.equal(MAX_CHINA_PRODUCT_LINKS, 5);
  assert.equal(links.length, 5);
  assert.equal(links[0], "https://detail.1688.com/offer/1.html");
  assert.equal(links[4], "https://detail.1688.com/offer/5.html");
});

test("선택한 링크를 상세페이지 엔진과 발주 기준용 1번으로 고정한다", () => {
  const pinned = promoteChinaProductLink(
    [
      "https://detail.1688.com/offer/1.html",
      "https://detail.1688.com/offer/2.html",
      "https://detail.1688.com/offer/3.html",
      "",
      "",
    ],
    2,
  );
  assert.equal(pinned[0], "https://detail.1688.com/offer/3.html");
  assert.equal(pinned[1], "https://detail.1688.com/offer/1.html");
  assert.equal(pinned[2], "https://detail.1688.com/offer/2.html");
  assert.equal(pinned.length, 5);
});

test("1번 링크를 상세페이지 엔진 대표 필드로 함께 저장한다", () => {
  const item = applyChinaProductLinks(
    {
      id: "item-1",
      modelNumber: "AAA492",
      detailPageSource: { resultId: "old" },
    },
    [
      "https://detail.1688.com/offer/primary.html",
      "https://detail.1688.com/offer/secondary.html",
    ],
    { now: new Date("2026-08-01T00:00:00.000Z") },
  );
  assert.equal(
    item.primaryChinaProductLink,
    "https://detail.1688.com/offer/primary.html",
  );
  assert.deepEqual(item.chinaProductLinks, [
    "https://detail.1688.com/offer/primary.html",
    "https://detail.1688.com/offer/secondary.html",
  ]);
  assert.equal(
    item.detailPageSource.primaryUrl,
    "https://detail.1688.com/offer/primary.html",
  );
  assert.deepEqual(item.detailPageSource.urls, item.chinaProductLinks);
  assert.equal(item.detailPageSource.pinnedIndex, 0);
  assert.equal(item.detailPageSource.resultId, "old");
  assert.equal(sameChinaProductLinks(item, item.chinaProductLinks), true);
  assert.deepEqual(readChinaProductLinks(item), item.chinaProductLinks);
});

test("단일 옵션의 옵션 바코드가 비어 있으면 상품 기준 B-code를 중국옵션 매핑에 사용하고 저장한다", () => {
  const item = {
    id: "single-option",
    barcode: "BCB7-1",
    chinaProductLinks: ["https://detail.1688.com/offer/single.html"],
    orderOptions: [{ id: "o1", barcode: "", saleOption: "블랙" }],
  };
  const mappings = readChinaOrderOptionMappings(item);
  assert.equal(mappings.length, 1);
  assert.equal(mappings[0].barcode, "BCB7-1");
  assert.equal(mappings[0].saleOption, "블랙");

  const next = applyChinaOrderOptionMappings(item, [
    {
      ...mappings[0],
      chinaOption: "黑色",
    },
  ]);
  assert.equal(next.orderOptions[0].barcode, "BCB7-1");
  assert.equal(next.orderOptions[0].chinaOption, "黑色");
  assert.equal(next.orderOptions[0].supplierLink, undefined);
});

test("각 B-code는 중국옵션만 따로 저장하고 주문링크는 상품 1번 링크를 공통 사용한다", () => {
  const links = [
    "https://detail.1688.com/offer/a.html",
    "https://detail.1688.com/offer/b.html",
  ];
  const base = applyChinaProductLinks(
    {
      id: "item-options",
      orderOptions: [
        { id: "o1", barcode: "BAC4-1", saleOption: "사이즈: A" },
        { id: "o2", barcode: "BAC4-2", saleOption: "사이즈: B" },
      ],
    },
    links,
  );
  const next = applyChinaOrderOptionMappings(base, [
    {
      id: "o1",
      barcode: "BAC4-1",
      saleOption: "사이즈: A",
      supplierLink: links[1],
      chinaOption: "中国规格A",
    },
    {
      id: "o2",
      barcode: "BAC4-2",
      saleOption: "사이즈: B",
      supplierLink: links[1],
      chinaOption: "中国规格B",
    },
  ]);
  const mappings = readChinaOrderOptionMappings(next);
  assert.deepEqual(
    mappings.map((row) => [row.barcode, row.saleOption, row.chinaOption]),
    [
      ["BAC4-1", "사이즈: A", "中国规格A"],
      ["BAC4-2", "사이즈: B", "中国规格B"],
    ],
  );
  assert.deepEqual(next.chinaProductLinks, links);
  assert.equal(next.orderOptions[0].supplierLink, undefined);
  assert.equal(next.orderOptions[1].supplierLink, undefined);
  assert.equal(sameChinaOrderOptionMappings(next, mappings), true);
});

test("B-code 중국옵션 입력에 과거 supplierLink 값이 들어와도 매핑 계약에서는 제거한다", () => {
  const item = {
    orderOptions: [{ id: "o1", barcode: "BAC4-1", saleOption: "A" }],
  };
  const next = applyChinaOrderOptionMappings(item, [
    {
      id: "o1",
      barcode: "BAC4-1",
      saleOption: "A",
      supplierLink: "https://detail.1688.com/offer/old-option-link.html",
      chinaOption: "红色",
    },
  ]);
  const mapping = readChinaOrderOptionMappings(next)[0];
  assert.equal(mapping.chinaOption, "红色");
  assert.equal("supplierLink" in mapping, false);
});

test("중국 링크 UI는 5칸·1번 고정을 유지하고 active B-code UI는 중국옵션만 저장한다", async () => {
  const legacyUi = await readFile(
    new URL(
      "../public/product-launch-tracker-app/china-product-links.js",
      import.meta.url,
    ),
    "utf8",
  );
  const activeUi = await readFile(
    new URL(
      "../public/product-launch-tracker-app/optimized-china-order-mapping.js",
      import.meta.url,
    ),
    "utf8",
  );
  const app = await readFile(
    new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
    "utf8",
  );
  assert.match(legacyUi, /MAX_CHINA_PRODUCT_LINKS/);
  assert.match(legacyUi, /1번으로 고정/);
  assert.match(activeUi, /B-code별 중국옵션/);
  assert.doesNotMatch(activeUi, /data-optimized-china-order-link-select/);
  assert.match(activeUi, /data-optimized-china-order-option-input/);
  assert.match(activeUi, /이 모델의 발주용 링크를 사용합니다/);
  assert.match(activeUi, /applyChinaOrderOptionMappings/);
  assert.match(activeUi, /mode: "item"/);
  assert.match(activeUi, /operation: "patch_item"/);
  assert.doesNotMatch(activeUi, /MutationObserver/);
  assert.match(app, /optimized-china-order-mapping\.js/);
});

test("기본 상세 저장의 preventDefault 이후에도 중국옵션을 저장하고 저장 버튼을 화면에 고정한다", async () => {
  const ui = await readFile(
    new URL(
      "../public/product-launch-tracker-app/china-product-links.js",
      import.meta.url,
    ),
    "utf8",
  );
  const activeUi = await readFile(
    new URL(
      "../public/product-launch-tracker-app/optimized-china-order-mapping.js",
      import.meta.url,
    ),
    "utf8",
  );
  const html = await readFile(
    new URL("../public/product-launch-tracker-app/index.html", import.meta.url),
    "utf8",
  );
  const styles = await readFile(
    new URL("../public/product-launch-tracker-app/styles.css", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(
    ui,
    /event\.defaultPrevented \|\| event\.submitter\?\.value !== "save"/,
  );
  assert.match(activeUi, /waitForMainSave/);
  assert.match(activeUi, /if \(detailDialog\?\.open\)/);
  assert.match(html, /class="button button-primary detail-floating-save" value="save"/);
  assert.match(styles, /\.detail-floating-save\s*\{[^}]*position: fixed/s);
});
