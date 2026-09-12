import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function arrayLiteralCount(sourceText, exportName) {
  const start = sourceText.indexOf(`export const ${exportName} = [`);
  assert.ok(start >= 0, `${exportName} not found`);
  const end = sourceText.indexOf("] as const", start);
  assert.ok(end > start, `${exportName} end not found`);
  return [...sourceText.slice(start, end).matchAll(/"AAA[^\"]+"/g)].map(
    (match) => match[0].slice(1, -1),
  );
}

test("사용자 확인 이전상품 46개 모델이 중복 없이 고정된다", async () => {
  const recovery = await source("src/lib/legacySeoStockRecovery.ts");
  const models = arrayLiteralCount(recovery, "LEGACY_SEO_CONFIRMED_STOCK_MODELS");
  assert.equal(models.length, 46);
  assert.equal(new Set(models).size, 46);
  assert.ok(models.includes("AAA074-1"));
  assert.ok(models.includes("AAA220"));
  assert.ok(models.includes("AAA360"));
});

test("실재고 사전 복구는 과거 1165행 컷오프 없이 B/C/E/F/BD:BG 원본을 사용한다", async () => {
  const recovery = await source("src/lib/legacySeoStockRecovery.ts");
  assert.match(recovery, /Row 4 is the header/);
  assert.doesNotMatch(recovery, /cutoffRow\s*:\s*1165/);
  assert.match(recovery, /modelNumber = normalizeLegacySeoStockModel\(row\[1\]\)/);
  assert.match(recovery, /productName = cleanText\(row\[2\]\)/);
  assert.match(recovery, /saleOption: cleanText\(row\[4\]\)/);
  assert.match(recovery, /chinaOption: cleanText\(row\[5\]\)/);
  assert.match(recovery, /row\[55\], row\[56\], row\[57\], row\[58\]/);
  assert.match(recovery, /barcode: ""/);
});

test("복구 API는 원장 1회 저장 후 정규화와 Shopling 옵션 동기화를 수행한다", async () => {
  const route = await source("src/app/api/legacy-seo-source-recovery/route.ts");
  assert.match(route, /operation: "create_items"/);
  assert.match(route, /stageKey: "shoplingUpload"/);
  assert.match(route, /status: "완료"/);
  assert.match(route, /writeProductLaunchState/);
  assert.match(route, /syncProductLaunchNormalizedChangedItems/);
  assert.match(route, /syncLegacySeoShoplingOptions/);
  assert.match(route, /legacy-seo-stock-recovery-20260908/);
  assert.doesNotMatch(route, /marketRegistration: stage\("완료"/);
});

test("Shopling 근거가 Product Master에 없으면 확인 모델만 등록일 구간으로 역탐색한다", async () => {
  const evidence = await source("src/lib/legacySeoShoplingEvidence.ts");
  assert.match(evidence, /buildLegacyShoplingModelDiscoveryXml/);
  assert.match(evidence, /search_tp.*등록일/s);
  assert.match(evidence, /isConfirmedLegacyInventoryModel\(model\)/);
  assert.match(evidence, /discoverGoodsKeysByModel/);
  assert.match(evidence, /"sale_price"/);
  assert.match(evidence, /"dtl_desc"/);
  assert.match(evidence, /const SHOPLING_PRODUCT_IMAGE_FIELDS = Array\.from/);
  assert.match(evidence, /\{ length: 32 \}/);
  assert.match(evidence, /`img_\$\{index\}`/);
  assert.match(evidence, /\.\.\.SHOPLING_PRODUCT_IMAGE_FIELDS/);
});

test("누락 이전상품 복구기는 유지하되 운영 화면에서 자동 실행하지 않는다", async () => {
  const enhancer = await source(
    "src/app/legacy-seo-bulk-cloud/LegacySeoSourceRecoveryEnhancer.tsx",
  );
  const page = await source("src/app/legacy-seo-bulk-cloud/page.tsx");
  assert.match(enhancer, /legacy-seo-run-jobs-lite\?items=true/);
  assert.match(enhancer, /legacy-seo-source-recovery\?apply=1/);
  assert.match(enhancer, /window\.location\.reload\(\)/);
  assert.doesNotMatch(enhancer, /MutationObserver/);
  assert.doesNotMatch(page, /LegacySeoSourceRecoveryEnhancer/);
});
