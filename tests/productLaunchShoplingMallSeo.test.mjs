import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PRODUCT_GROUP_MARKET_REGISTRY } from "../src/lib/productGroupMarketRegistry.ts";
import { buildProductLaunchMallSeoPlan } from "../src/lib/productLaunchShoplingMallSeo.ts";
import { parseKeywordShoplingDirectPlan } from "../src/lib/keywordShoplingDirectApplyRunner.ts";

const goodsKeys = {
  도매1: "121467",
  도매2: "121468",
  도매3: "121469",
  도매4: "121470",
  소매1: "121471",
  소매2: "121472",
};

const channelByGroup = {
  도매1: "wholesale1",
  도매2: "wholesale2",
  도매3: "wholesale3",
  도매4: "wholesale4",
  소매1: "retail1",
  소매2: "retail2",
};

function readyItem() {
  return {
    shoplingProducts: Object.fromEntries(
      Object.entries(goodsKeys).map(([group, goodsKey]) => [
        channelByGroup[group],
        { goodsKey, status: "success" },
      ]),
    ),
    seoFinal: {
      searchKeywords: [
        "차량용핸드폰거치대",
        "휴대폰거치대",
        "차량용거치대",
        "차량용휴대폰거치대",
        "차량핸드폰거치대",
        "핸드폰차량거치대",
        "자동차핸드폰거치대",
        "거치대",
        "자동차휴대폰거치대",
        "핸드폰거치대",
      ],
      mallTitles: PRODUCT_GROUP_MARKET_REGISTRY.map((market, index) => ({
        productGroup: market.productGroup,
        marketName: market.marketName,
        mallKey: market.mallKey,
        accountIdLabel: market.accountIdLabel,
        title: `테스트 상품명 ${index + 1}`,
      })),
    },
  };
}

test("SEO Cloud 29개 상품명을 6개 goods_key의 쇼핑몰별 direct apply 계획으로 변환한다", () => {
  const plan = buildProductLaunchMallSeoPlan(readyItem());
  assert.equal(plan.length, PRODUCT_GROUP_MARKET_REGISTRY.length);
  assert.equal(plan.length, 29);
  assert.equal(new Set(plan.map((row) => `${row.goods_key}:${row.mall_key}`)).size, 29);
  for (let index = 0; index < plan.length; index += 1) {
    const market = PRODUCT_GROUP_MARKET_REGISTRY[index];
    const row = plan[index];
    assert.equal(row.mall_key, market.mallKey);
    assert.equal(row.goods_key, goodsKeys[market.productGroup]);
    assert.equal(row.final_title, `테스트 상품명 ${index + 1}`);
    assert.equal(row.final_site_srch.split(",").length, 10);
    assert.ok(row.final_site_srch.split(",").every((keyword) => !/\s/.test(keyword)));
  }
});

test("29개 상품명 재고가 부족하거나 goods_key가 없으면 실제반영 계획을 차단한다", () => {
  const missingTitle = readyItem();
  missingTitle.seoFinal.mallTitles.pop();
  assert.throws(() => buildProductLaunchMallSeoPlan(missingTitle), /29개/);

  const missingGoods = readyItem();
  missingGoods.shoplingProducts.retail2.goodsKey = "";
  assert.throws(() => buildProductLaunchMallSeoPlan(missingGoods), /소매2 goods_key/);
});

test("필수 검색어 한두 개의 내부 공백을 29개 마켓의 공통 Shopling 실행 계획에 보존한다", () => {
  const item = readyItem();
  const keywords = ["MBTI 키보드 키링", "게임 키링", ...item.seoFinal.searchKeywords.slice(2)];
  item.seoFinal.searchLine = ` , ${keywords.join(" , ")} , `;
  const plan = parseKeywordShoplingDirectPlan(buildProductLaunchMallSeoPlan(item));
  assert.equal(plan.length, 29);
  for (const row of plan) assert.equal(row.final_site_srch, keywords.join(","));
});

test("등록 실행기는 29개 상품명을 저장하고 신규 자동후적용·기존 후적용 경로를 모두 포함한다", async () => {
  const runner = await readFile(
    new URL("../src/app/seo-title-cloud-shopling-runner/SeoTitleCloudShoplingRunnerPanel.tsx", import.meta.url),
    "utf8",
  );
  const callback = await readFile(
    new URL("../src/app/api/product-launch-tracker/upload-jobs/[jobId]/route.ts", import.meta.url),
    "utf8",
  );
  const repairRoute = await readFile(
    new URL("../src/app/api/product-launch-tracker/shopling-mall-seo/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(runner, /mallTitles: output\.mallTitles\.map/);
  assert.match(runner, /쇼핑몰별 상품명 29개 후적용/);
  assert.match(runner, /SHOPLING_MALL_SEO_ENDPOINT/);
  assert.match(callback, /startMallSeoApply/);
  assert.match(callback, /dispatchProductLaunchMallSeo/);
  assert.match(callback, /reconcileProductLaunchNormalizedAfterLegacyItems/);
  assert.match(repairRoute, /dispatchProductLaunchMallSeo/);
  assert.match(repairRoute, /reconcileProductLaunchNormalizedAfterLegacyItems/);
});

test("취소된 direct-apply가 pending으로 고착되지 않고 실제 실행결과를 확인한 뒤 재시도한다", async () => {
  const repairRoute = await readFile(
    new URL("../src/app/api/product-launch-tracker/shopling-mall-seo/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(repairRoute, /fetchKeywordShoplingDirectApplyResult/);
  assert.match(repairRoute, /completeMallSeoResult/);
  assert.match(repairRoute, /direct_apply_completed/);
  assert.match(repairRoute, /title_apply_success_count/);
  assert.match(repairRoute, /EXPECTED_MALL_TITLE_COUNT = 29/);
  assert.match(repairRoute, /MAX_AUTO_RETRY_COUNT = 2/);
  assert.match(repairRoute, /SHOPLING_MALL_SEO_RETRY_LIMIT_REACHED/);
  assert.match(repairRoute, /previousRequestId/);
  assert.match(repairRoute, /자동 재시도를 시작했습니다/);
  assert.doesNotMatch(repairRoute, /SHOPLING_MALL_SEO_ALREADY_RUNNING/);
});
