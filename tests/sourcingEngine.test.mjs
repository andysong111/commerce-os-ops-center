import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRecommendationCard,
  checkCandidateRisk,
  generateChineseSearchTerms,
} from "../src/lib/sourcingEngine.ts";

const baseInput = {
  mode: "FOLLOW_PROVEN",
  koreanQuery: "차량용 틈새 수납함",
  competitorUrl: "https://example.com/product",
  targetPriceKrw: 9900,
  testBudgetKrw: 200000,
  forbiddenCategories: ["어린이", "의료", "산업용 안전", "유리", "전기", "화학", "상표"],
};

const baseSettings = {
  exchangeRateKrwPerCny: 190,
  testQuantity: 60,
  internationalShippingFeeKrw: 45000,
  agentFeeRate: 5,
};

test("generates practical 1688 Chinese search terms", () => {
  const terms = generateChineseSearchTerms("차량용 틈새 수납함");
  assert.ok(terms.includes("汽车缝隙收纳盒"));
  assert.ok(terms.length >= 3);
});

test("blocks high-risk child and medical products", () => {
  const risk = checkCandidateRisk(baseInput, {
    id: "danger",
    url: "https://detail.1688.com/offer/1.html",
    imageUrl: "",
    titleCn: "儿童医疗矫正按摩器",
    titleKr: "어린이 의료 교정 마사지기",
    unitPriceCny: 10,
    moq: 1,
    chinaShippingFeeCny: 0,
    optionsText: "",
    shopName: "",
    notes: "",
  });

  assert.equal(risk.level, "BLOCKED");
  assert.ok(risk.tags.includes("어린이/유아"));
  assert.ok(risk.tags.includes("의료/건강효능"));
});

test("recommends only stored 1688 candidate URLs", () => {
  const candidates = [
    {
      id: "c1",
      url: "https://detail.1688.com/offer/100.html",
      imageUrl: "https://img.example.com/1.jpg",
      titleCn: "汽车缝隙收纳盒",
      titleKr: "차량용 틈새 수납함",
      unitPriceCny: 8.6,
      moq: 2,
      chinaShippingFeeCny: 10,
      optionsText: "黑色,灰色",
      shopName: "A factory",
      notes: "",
    },
    {
      id: "c2",
      url: "https://detail.1688.com/offer/101.html",
      imageUrl: "https://img.example.com/2.jpg",
      titleCn: "车载缝隙储物盒",
      titleKr: "차량용 수납함",
      unitPriceCny: 9.2,
      moq: 2,
      chinaShippingFeeCny: 10,
      optionsText: "黑色",
      shopName: "B factory",
      notes: "",
    },
    {
      id: "c3",
      url: "https://detail.1688.com/offer/102.html",
      imageUrl: "https://img.example.com/3.jpg",
      titleCn: "汽车座椅缝隙收纳",
      titleKr: "차량 좌석 틈새 수납",
      unitPriceCny: 9.5,
      moq: 2,
      chinaShippingFeeCny: 10,
      optionsText: "灰色",
      shopName: "C factory",
      notes: "",
    },
  ];

  const card = buildRecommendationCard({
    input: baseInput,
    settings: baseSettings,
    candidates,
  });

  const storedUrls = new Set(candidates.map((candidate) => candidate.url));
  assert.equal(card.decision, "ORDER_READY");
  assert.ok(card.primary);
  assert.ok(storedUrls.has(card.primary.candidate.url));
  for (const backup of card.backups) {
    assert.ok(storedUrls.has(backup.candidate.url));
  }
});
