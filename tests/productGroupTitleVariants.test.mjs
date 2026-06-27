import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getMarketsForProductGroup } from "../src/lib/productGroupMarketRegistry.ts";
import { buildExpandedGroupMarketApplyItems, buildGroupTitleVariant, buildMallSpecificTitleVariant, extractSafeAttributeModifiers } from "../src/lib/productTitleVariants.ts";

function source(productGroup = "도매1") { return { goodsKey: "G1", productGroup, productGroupType: productGroup.startsWith("소매") ? "소매" : "도매", groupSuffix: "a", baseTitle: "미니 스텐 수납 정리 주방 세트 게임패드 컨트롤러", originalTitle: "미니 스텐 수납 정리 주방 세트", siteSrch: "미니, 스텐, 수납, 정리, 주방, 세트, 깔끔" }; }
function row(productGroup = "도매1", goodsKey = "G1") { return { ...source(productGroup), goodsKey, mallKey: "SMALL_00004", originalTitle: "미니 스텐 수납 정리 주방 세트", recommendedTitle: "미니 스텐 수납 정리 주방 세트 게임패드 컨트롤러", originalSiteSrch: "미니, 수납", recommendedSiteSrch: "미니, 스텐, 수납, 정리, 주방, 세트, 깔끔, 게임패드, 컨트롤러, 조이스틱", editedTitle: "미니 스텐 수납 정리 주방 세트 게임패드 컨트롤러", editedSiteSrch: "미니, 스텐, 수납, 정리, 주방, 세트, 깔끔, 게임패드, 컨트롤러, 조이스틱", editedMallKey: "SMALL_00004", reviewStatus: "approved", classification: "manual_review", sourceRowIndex: 1, ptnGoodsCd: "PTN", groupSuffix: productGroup === "도매4" ? "d" : productGroup === "소매1" ? "e" : "a", productGroupStatus: "ok", blockReason: "", warningFlags: "", manualCandidateKeywords: "" }; }

test("productGroupMarketRegistry has expected markets", () => {
  assert.equal(getMarketsForProductGroup("도매1").length, 10);
  assert.equal(getMarketsForProductGroup("도매2").length, 4);
  assert.equal(getMarketsForProductGroup("도매3").length, 4);
  assert.equal(getMarketsForProductGroup("도매4").length, 1);
  assert.equal(getMarketsForProductGroup("소매1").length, 12);
  assert.equal(getMarketsForProductGroup("소매2").length, 5);
  assert.ok(getMarketsForProductGroup("도매1").some((m) => m.mallKey === "SMALL_00069" && m.marketName === "도매꾹" && m.accountIdLabel === "andy8010"));
  assert.ok(getMarketsForProductGroup("소매1").some((m) => m.mallKey === "SMALL_00004" && m.marketName === "스마트스토어" && m.accountIdLabel === "andy8010@naver.com"));
  assert.ok(getMarketsForProductGroup("소매2").some((m) => m.mallKey === "SMALL_00194" && m.marketName === "토스쇼핑" && m.accountIdLabel === "andy80101@naver.com"));
});

test("safe modifier extraction uses source only", () => {
  assert.deepEqual(extractSafeAttributeModifiers({ ...source(), baseTitle: "미니 게임패드 컨트롤러 조이스틱", originalTitle: "", siteSrch: "" }).sizeShape, ["미니"]);
  const modifiers = extractSafeAttributeModifiers({ ...source(), baseTitle: "게임패드", siteSrch: "수납, 정리" });
  assert.ok(modifiers.function.includes("수납") && modifiers.function.includes("정리"));
  assert.equal(extractSafeAttributeModifiers({ ...source(), baseTitle: "방수 게임패드", siteSrch: "" }).material.includes("방수"), false);
  assert.equal(Object.values(extractSafeAttributeModifiers({ ...source(), baseTitle: "게임패드 컨트롤러", originalTitle: "", siteSrch: "" })).flat().length, 0);
});

test("group and mall title variants are differentiated and safe", () => {
  const titles = ["도매1", "도매2", "도매3", "도매4", "소매1", "소매2"].map((group) => buildGroupTitleVariant(source(group)).groupTitle);
  assert.ok(new Set(titles).size > 1);
  for (const title of titles) { assert.ok(title.length > 0); const words = title.split(/\s+/); assert.equal(words.length, new Set(words).size); }
  const markets = getMarketsForProductGroup("도매1");
  const a = buildMallSpecificTitleVariant(source("도매1"), markets[0]);
  const b = buildMallSpecificTitleVariant(source("도매1"), markets[1]);
  assert.notEqual(a.mallTitle, b.mallTitle);
  assert.equal(a.mallTitle, buildMallSpecificTitleVariant(source("도매1"), markets[0]).mallTitle);
});

test("apply plan expansion counts, blocking, and duplicate goods/mall removal", () => {
  assert.equal(buildExpandedGroupMarketApplyItems([row("도매1")], true).items.length, 10);
  assert.equal(buildExpandedGroupMarketApplyItems([row("소매1")], true).items.length, 12);
  assert.equal(buildExpandedGroupMarketApplyItems([row("도매4")], true).items.length, 1);
  assert.equal(buildExpandedGroupMarketApplyItems([row("미등록")], true).blockedRows.length, 1);
  assert.equal(buildExpandedGroupMarketApplyItems([row("도매4", "G1"), row("도매4", "G1")], true).items.length, 1);
});

test("UI source includes group variant controls and security-sensitive strings are absent", () => {
  const ui = readFileSync("src/app/keyword-review-queue/page.tsx", "utf8");
  for (const text of ["상품그룹별 상품명 차별화", "상품그룹별 속성 꾸밈어 적용", "상품그룹에 연결된 모든 쇼핑몰로 적용 대상 확장", "상품그룹/쇼핑몰별 상품명 미리보기", "상품에 실제로 확인되는 속성만 꾸밈어로 사용합니다", "미확인 속성, 인증, 방수, 최저가 등 위험 표현은 자동 추가하지 않습니다"]) assert.ok(ui.includes(text));
  const all = readFileSync("src/lib/productTitleVariants.ts", "utf8") + ui;
  for (const bad of ["child_process", "shell: true", "PowerShell", "API_AUTH_KEY", "LOGIN_PASSWORD", "localStorage.setItem(\"token", "raw XML"]) assert.equal(all.includes(bad), false);
});

test("guided action approves first candidates and only generates previews", () => {
  const ui = readFileSync("src/app/keyword-review-queue/page.tsx", "utf8");
  const guided = ui.slice(ui.indexOf("onApplyPreview={() =>"), ui.indexOf("<PayloadPreviewSection"));
  assert.match(guided, /buildKeywordShoplingPayloadPreview|createGroupVariantPreviewRows|buildMallSpecificTitleVariant/);
  assert.doesNotMatch(guided, /dispatch|fetch\s*\(|run\("apply"|keywordShoplingApply/i);
});
