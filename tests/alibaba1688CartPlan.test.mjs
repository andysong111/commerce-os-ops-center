import assert from "node:assert/strict";
import test from "node:test";
import {
  build1688CartPlan,
  buildDraftLinesFrom1688Checkout,
  normalize1688OptionName,
  parse1688OfferLink,
  plan1688CartReconciliation,
  split1688OptionNames,
} from "../local-agent/src/alibaba1688-cart-plan.mjs";
import {
  ALIBABA1688_CHECKOUT_SHIPPING_PROBE_EXPRESSION,
  ALIBABA1688_FORBIDDEN_ORDER_TEXT,
  ALIBABA1688_OFFER_PROBE_EXPRESSION,
  ALIBABA1688_ORDER_SUBMIT_PROBE_EXPRESSION,
  ALIBABA1688_PAYMENT_SELECTION_PROBE_EXPRESSION,
  buildAlibaba1688CheckoutProbeExpression,
  chooseAlibaba1688ShippingPreference,
} from "../local-agent/src/alibaba1688-cart-browser-adapter.mjs";
import { readFile } from "node:fs/promises";

function draft(lines) {
  return {
    draftId: "fast-purchase-draft:8c51000fd221316c2f54",
    status: "DRAFT",
    lines: lines.map((line) => ({
      modelNo: "AAA001",
      modelName: "테스트",
      productName: "테스트 상품",
      saleOption: "기본",
      unitPriceCny: 1,
      freightGroupId: "",
      domesticChinaFreightCny: 0,
      orderNumber: "",
      note: "사용자 메모",
      ...line,
    })),
  };
}

test("1688 offer links and exact option names are normalized conservatively", () => {
  assert.deepEqual(parse1688OfferLink("https://detail.1688.com/offer/660021847749.html?spm=x"), {
    offerId: "660021847749",
    url: "https://detail.1688.com/offer/660021847749.html",
  });
  assert.equal(parse1688OfferLink("https://example.com/offer/660021847749.html"), null);
  assert.equal(normalize1688OptionName(" 紫色 ( 中文说明书 ) "), "紫色 ( 中文说明书 )");
  assert.equal(normalize1688OptionName("A302 蜡黄 / 小号"), "a302 蜡黄/小号");
  assert.deepEqual(split1688OptionNames("透明 精灵耳贴【硅胶】, 60贴袋装"), ["透明 精灵耳贴【硅胶】", "60贴袋装"]);
  assert.deepEqual(split1688OptionNames("红色，礼盒装"), ["红色", "礼盒装"]);
});

test("comma-separated 1688 option axes are matched independently and carried to browser actions", () => {
  const source = draft([{
    barcode: "BAA1-1",
    supplierLink: "https://detail.1688.com/offer/817041594793.html",
    chinaOption: "透明 精灵耳贴【硅胶】,60贴袋装",
    quantity: 10,
  }]);
  const inspection = [{
    offerId: "817041594793",
    options: [
      { name: "透明 精灵耳贴【硅胶】", purchasable: true },
      { name: "60贴袋装", purchasable: true },
    ],
  }];
  const plan = build1688CartPlan(source, inspection);
  assert.deepEqual(plan.items[0].optionNames, ["透明 精灵耳贴【硅胶】", "60贴袋装"]);
  assert.equal(plan.items[0].optionName, "透明 精灵耳贴【硅胶】,60贴袋装");
  assert.throws(
    () => build1688CartPlan(source, [{ ...inspection[0], options: inspection[0].options.slice(0, 1) }]),
    { code: "ALIBABA1688_OPTION_NOT_FOUND" },
  );
});

test("same 1688 offer and option aggregate quantities without losing B-code rows", () => {
  const source = draft([
    { barcode: "BAC3-3", supplierLink: "https://detail.1688.com/offer/660021847749.html", chinaOption: "铜芯", quantity: 18 },
    { barcode: "BAC3-4", supplierLink: "https://detail.1688.com/offer/660021847749.html", chinaOption: "铜芯", quantity: 7 },
  ]);
  const plan = build1688CartPlan(source, [{
    offerId: "660021847749",
    options: [{ name: "铜芯", purchasable: true }],
  }]);
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].quantity, 25);
  assert.deepEqual(plan.items[0].barcodes, ["BAC3-3", "BAC3-4"]);
  assert.equal(plan.lines.length, 2);
});

test("pair packaging multiplies the physical 1688 quantity and stores cost per sellable pair", () => {
  const source = draft([{
    barcode: "BCB6-2",
    supplierLink: "https://detail.1688.com/offer/639347792003.html",
    chinaOption: "黑色",
    purchaseQuantityMultiplier: 2,
    quantity: 15,
  }]);
  const plan = build1688CartPlan(source, [{ offerId: "639347792003", options: [{ name: "黑色" }] }]);
  assert.equal(plan.items[0].quantity, 30);
  assert.equal(plan.lines[0].baseQuantity, 15);
  assert.equal(plan.lines[0].quantityMultiplier, 2);
  const lines = buildDraftLinesFrom1688Checkout(source, plan, {
    lines: [{ offerId: "639347792003", optionName: "黑色", quantity: 30, unitPriceCny: 1.2, groupId: "seller-pair" }],
    sellerGroups: [{ groupId: "seller-pair", domesticFreightCny: 4 }],
  });
  assert.equal(lines[0].quantity, 15);
  assert.equal(lines[0].unitPriceCny, 2.4);
});

test("a bundled product creates both required 1688 component lines and aggregates unit cost", () => {
  const source = draft([{
    barcode: "BCB3-1",
    supplierLink: "https://detail.1688.com/offer/705070728628.html",
    chinaOption: "金属钳子 + 空心银色50套",
    purchaseComponents: [
      { chinaOption: "金属钳子", quantityMultiplier: 1 },
      { chinaOption: "空心银色50套", quantityMultiplier: 1 },
    ],
    quantity: 10,
  }]);
  const options = [{ name: "金属钳子" }, { name: "空心银色50套" }];
  const plan = build1688CartPlan(source, [{ offerId: "705070728628", options }]);
  assert.equal(plan.lineCount, 1);
  assert.equal(plan.items.length, 2);
  assert.deepEqual(plan.items.map((item) => item.quantity), [10, 10]);
  const lines = buildDraftLinesFrom1688Checkout(source, plan, {
    lines: [
      { offerId: "705070728628", optionName: "金属钳子", quantity: 10, unitPriceCny: 4, groupId: "seller-kit" },
      { offerId: "705070728628", optionName: "空心银色50套", quantity: 10, unitPriceCny: 2, groupId: "seller-kit" },
    ],
    sellerGroups: [{ groupId: "seller-kit", domesticFreightCny: 5 }],
  });
  assert.equal(lines[0].unitPriceCny, 6);
  assert.equal(lines[0].domesticChinaFreightCny, 5);
});

test("random-color policy deterministically selects the first purchasable 1688 option", () => {
  const source = draft([{
    barcode: "BEE5-1",
    supplierLink: "https://detail.1688.com/offer/702959747316.html",
    chinaOption: "任一可售颜色（自动）",
    purchaseOptionSelection: "ANY_AVAILABLE",
    quantity: 5,
  }]);
  const plan = build1688CartPlan(source, [{
    offerId: "702959747316",
    options: [{ name: "蓝色", purchasable: false }, { name: "灰色", purchasable: true }, { name: "粉色", purchasable: true }],
  }]);
  assert.equal(plan.items[0].optionName, "灰色");
});

test("single-SKU marker is accepted only when the inspected offer is unambiguous", () => {
  const source = draft([
    { barcode: "BBB4-1", supplierLink: "https://detail.1688.com/offer/843297532637.html", chinaOption: "단품", quantity: 20 },
  ]);
  assert.equal(build1688CartPlan(source, [{ offerId: "843297532637", singleSku: true, options: [] }]).items[0].optionName, "단품");
  assert.throws(
    () => build1688CartPlan(source, [{ offerId: "843297532637", options: [{ name: "红" }, { name: "蓝" }] }]),
    { code: "ALIBABA1688_SINGLE_OPTION_AMBIGUOUS" },
  );
});

test("cart reconciliation sets the exact quantity instead of incrementing on retry", () => {
  const source = draft([
    { barcode: "BAD5-2", supplierLink: "https://detail.1688.com/offer/738461076321.html", chinaOption: "L", quantity: 15 },
  ]);
  const plan = build1688CartPlan(source, [{ offerId: "738461076321", options: [{ name: "L" }] }]);
  const set = plan1688CartReconciliation(plan, [{ offerId: "738461076321", optionName: "L", quantity: 30 }]);
  assert.equal(set[0].type, "SET_QUANTITY");
  assert.equal(set[0].quantity, 15);
  const keep = plan1688CartReconciliation(plan, [{ offerId: "738461076321", optionName: "l", quantity: 15 }]);
  assert.equal(keep[0].type, "KEEP");
});

test("post-cart actual price and one seller-group freight total update every draft row", () => {
  const source = draft([
    { barcode: "BAC3-3", supplierLink: "https://detail.1688.com/offer/660021847749.html", chinaOption: "铜芯", quantity: 18, unitPriceCny: 1.2 },
    { barcode: "BAD5-2", supplierLink: "https://detail.1688.com/offer/738461076321.html", chinaOption: "L", quantity: 15, unitPriceCny: 2.1 },
  ]);
  const inspections = [
    { offerId: "660021847749", options: [{ name: "铜芯" }] },
    { offerId: "738461076321", options: [{ name: "L" }] },
  ];
  const plan = build1688CartPlan(source, inspections);
  const lines = buildDraftLinesFrom1688Checkout(source, plan, {
    lines: [
      { offerId: "660021847749", optionName: "铜芯", quantity: 18, unitPriceCny: 1.65, groupId: "seller-88" },
      { offerId: "738461076321", optionName: "L", quantity: 15, unitPriceCny: 2.45, groupId: "seller-88" },
    ],
    sellerGroups: [{ groupId: "seller-88", domesticFreightCny: 12.5 }],
  });
  assert.deepEqual(lines.map((line) => line.unitPriceCny), [1.65, 2.45]);
  assert.deepEqual(lines.map((line) => line.freightGroupId), ["1688-cart:seller-88", "1688-cart:seller-88"]);
  assert.deepEqual(lines.map((line) => line.domesticChinaFreightCny), [12.5, 0]);
  assert.deepEqual(lines.map((line) => line.note), ["사용자 메모", "사용자 메모"]);
});

test("post-cart unit price keeps enough precision to reproduce the exact checkout subtotal", () => {
  const source = draft([
    { barcode: "BBA7-3", supplierLink: "https://detail.1688.com/offer/923615736263.html", chinaOption: "深空灰压罐器", quantity: 10, unitPriceCny: 0 },
  ]);
  const plan = build1688CartPlan(source, [{ offerId: "923615736263", options: [{ name: "深空灰压罐器" }] }]);
  const lines = buildDraftLinesFrom1688Checkout(source, plan, {
    lines: [{ offerId: "923615736263", optionName: "深空灰压罐器", quantity: 10, unitPriceCny: 144.97 / 10, groupId: "seller-exact" }],
    sellerGroups: [{ groupId: "seller-exact", domesticFreightCny: 16.42 }],
  });
  assert.equal(lines[0].unitPriceCny, 14.497);
  assert.equal(lines[0].unitPriceCny * lines[0].quantity, 144.97);
});

test("a one-item canary updates its line while preserving every untouched draft row", () => {
  const source = draft([
    { barcode: "BAC3-3", supplierLink: "https://detail.1688.com/offer/660021847749.html", chinaOption: "铜芯", quantity: 18, unitPriceCny: 1.2 },
    { barcode: "BAD5-2", supplierLink: "https://detail.1688.com/offer/738461076321.html", chinaOption: "L", quantity: 15, unitPriceCny: 2.1 },
  ]);
  const canaryDraft = { ...source, lines: [source.lines[0]] };
  const plan = build1688CartPlan(canaryDraft, [{ offerId: "660021847749", options: [{ name: "铜芯" }] }]);
  const lines = buildDraftLinesFrom1688Checkout(source, plan, {
    lines: [{ offerId: "660021847749", optionName: "铜芯", quantity: 18, unitPriceCny: 1.75, groupId: "seller-a" }],
    sellerGroups: [{ groupId: "seller-a", domesticFreightCny: 6 }],
  });
  assert.equal(lines.length, 2);
  assert.equal(lines[0].unitPriceCny, 1.75);
  assert.equal(lines[0].domesticChinaFreightCny, 6);
  assert.equal(lines[1], source.lines[1]);
});

test("checkout save is blocked when an exact line, quantity, price, or freight group is missing", () => {
  const source = draft([
    { barcode: "BAF3-1", supplierLink: "https://detail.1688.com/offer/744876526049.html", chinaOption: "紫色(中文说明书)", quantity: 40 },
  ]);
  const plan = build1688CartPlan(source, [{ offerId: "744876526049", options: [{ name: "紫色(中文说明书)" }] }]);
  assert.throws(
    () => buildDraftLinesFrom1688Checkout(source, plan, { lines: [], sellerGroups: [] }),
    { code: "ALIBABA1688_CHECKOUT_LINE_MISSING" },
  );
  assert.throws(
    () => buildDraftLinesFrom1688Checkout(source, plan, {
      lines: [{ offerId: "744876526049", optionName: "紫色(中文说明书)", quantity: 39, unitPriceCny: 3.2, groupId: "seller" }],
      sellerGroups: [{ groupId: "seller", domesticFreightCny: 0 }],
    }),
    { code: "ALIBABA1688_CHECKOUT_QUANTITY_MISMATCH" },
  );
});

test("browser automation recognizes order submission and payment controls as forbidden", () => {
  for (const label of ["提交订单", "确认下单", "立即下单", "立即付款", "支付", "Pay now"]) {
    assert.match(label, ALIBABA1688_FORBIDDEN_ORDER_TEXT);
  }
  for (const safeLabel of ["加入购物车", "去结算", "购物车"]) {
    assert.doesNotMatch(safeLabel, ALIBABA1688_FORBIDDEN_ORDER_TEXT);
  }
});

test("order submission targets only the exact submit control and confirms payment selection without paying", () => {
  assert.match(ALIBABA1688_ORDER_SUBMIT_PROBE_EXPRESSION, /提交订单/);
  assert.match(ALIBABA1688_ORDER_SUBMIT_PROBE_EXPRESSION, /ORDER_SUBMIT_CONTROL_AMBIGUOUS/);
  assert.match(ALIBABA1688_ORDER_SUBMIT_PROBE_EXPRESSION, /totalCny/);
  assert.match(ALIBABA1688_ORDER_SUBMIT_PROBE_EXPRESSION, /clickButton/);
  assert.match(ALIBABA1688_ORDER_SUBMIT_PROBE_EXPRESSION, /button\.click\(\)/);
  assert.match(ALIBABA1688_PAYMENT_SELECTION_PROBE_EXPRESSION, /paymentSelectionConfirmed/);
  assert.match(ALIBABA1688_PAYMENT_SELECTION_PROBE_EXPRESSION, /选择\(\?:支付\|付款\)方式/);
  assert.match(ALIBABA1688_PAYMENT_SELECTION_PROBE_EXPRESSION, /&& paymentMarker/);
  assert.match(ALIBABA1688_PAYMENT_SELECTION_PROBE_EXPRESSION, /shadowRoot/);
  assert.doesNotMatch(ALIBABA1688_PAYMENT_SELECTION_PROBE_EXPRESSION, /\.click\(/);
});

test("checkout probe supports the current smart order DOM for quantity, final price, and seller freight", () => {
  const expression = buildAlibaba1688CheckoutProbeExpression([{
    offerId: "923615736263",
    optionName: "深空灰压罐器",
    optionNames: ["深空灰压罐器"],
    quantity: 10,
  }], [{ method: "OFFICIAL", tier: "STANDARD" }]);
  assert.match(expression, /order-group-container/);
  assert.match(expression, /q-inputnumber/);
  assert.match(expression, /final-unit-price/);
  assert.match(expression, /list-item-title/);
  assert.match(expression, /button-wrapper/);
  assert.match(expression, /官方物流补贴/);
  assert.match(expression, /selectedShippingMethod === \"OFFICIAL\"/);
  assert.match(expression, /cargo-amount/);
  assert.match(expression, /lineTotalCny \/ quantity/);
  assert.match(expression, /\"method\":\"OFFICIAL\"/);
});

test("checkout shipping chooses cheaper official delivery and the standard tier", () => {
  assert.deepEqual(chooseAlibaba1688ShippingPreference({
    merchant: { available: true, priceCny: 23 },
    official: { available: true, priceCny: 16.42 },
    tiers: [
      { code: "QUALITY", available: true },
      { code: "STANDARD", available: true },
      { code: "PREMIUM", available: true },
    ],
  }), {
    ok: true,
    method: "OFFICIAL",
    tier: "STANDARD",
    reason: "OFFICIAL_CHEAPER",
  });
  assert.match(ALIBABA1688_CHECKOUT_SHIPPING_PROBE_EXPRESSION, /官方配送/);
  assert.match(ALIBABA1688_CHECKOUT_SHIPPING_PROBE_EXPRESSION, /标准大件/);
  assert.match(ALIBABA1688_CHECKOUT_SHIPPING_PROBE_EXPRESSION, /shadowRoot/);
  assert.match(ALIBABA1688_CHECKOUT_SHIPPING_PROBE_EXPRESSION, /q-radio\[checked='true'\]/);
  assert.match(ALIBABA1688_CHECKOUT_SHIPPING_PROBE_EXPRESSION, /clickExact/);
});

test("checkout shipping keeps merchant delivery when official delivery is not cheaper", () => {
  assert.equal(chooseAlibaba1688ShippingPreference({
    merchant: { available: true, priceCny: 12 },
    official: { available: true, priceCny: 12 },
    tiers: [{ code: "STANDARD", available: true }],
  }).method, "MERCHANT");
  assert.equal(chooseAlibaba1688ShippingPreference({
    merchant: { available: true, priceCny: 10 },
    official: { available: true, priceCny: 14 },
    tiers: [{ code: "STANDARD", available: true }],
  }).method, "MERCHANT");
});

test("offer inspection recognizes the explicit 1688 logged-out page state", () => {
  assert.match(ALIBABA1688_OFFER_PROBE_EXPRESSION, /FE_GLOBALS/);
  assert.match(ALIBABA1688_OFFER_PROBE_EXPRESSION, /PC-UNLOGIN/);
  assert.match(ALIBABA1688_OFFER_PROBE_EXPRESSION, /login-button/);
});

test("offer and add probes recognize the current 1688 procurement-cart UI", async () => {
  assert.match(ALIBABA1688_OFFER_PROBE_EXPRESSION, /加采购车/);
  assert.match(ALIBABA1688_OFFER_PROBE_EXPRESSION, /expand-view-item/);
  const source = await readFile(
    new URL("../local-agent/src/alibaba1688-cart-browser-adapter.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /加采购车/);
  assert.match(source, /PER_SKU_QUANTITY/);
  assert.match(source, /ant-input-number-input/);
  assert.match(source, /Input\.insertText/);
  assert.match(source, /Input\.dispatchMouseEvent/);
  assert.match(source, /tr\[data-cart-id\]/);
  assert.match(source, /input\[aria-valuemin\]\[aria-valuemax\]/);
  assert.match(source, /value\?\.lines\?\.length > 0/);
});

test("offer inspection recognizes the Korean 1688 slider security challenge", () => {
  for (const label of ["슬라이더", "보안 인증", "인증을 완료", "밀어서 확인", "정상 접속"]) {
    assert.match(ALIBABA1688_OFFER_PROBE_EXPRESSION, new RegExp(label));
  }
});

test("task 5 waits through a manual slider retry and returns to the exact offer", async () => {
  const source = await readFile(
    new URL("../local-agent/src/alibaba1688-cart-browser-adapter.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /SECURITY_CHALLENGE_WAIT_MS = 180_000/);
  assert.match(source, /challengeFailed/);
  assert.match(source, /Page\.reload/);
  assert.match(source, /waitForOfferSecurityChallenge/);
  assert.match(source, /Successful verification can redirect to the 1688 home page/);
  assert.match(source, /OFFER_NAVIGATION_TIMEOUT_MS \+ SECURITY_CHALLENGE_WAIT_MS/);
});

test("slow 1688 offer loading is retried and only explicit 404 or down markers mean offline", async () => {
  const source = await readFile(
    new URL("../local-agent/src/alibaba1688-cart-browser-adapter.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /OFFER_NAVIGATION_TIMEOUT_MS = 60_000/);
  assert.match(source, /OFFER_RETRY_COUNT = 2/);
  assert.match(source, /const target = await create1688Target\(config, unique\[0\]\?\.offerUrl \|\| CART_URL, dependencies\)/);
  assert.match(source, /const target = lastTarget \|\| await ensure1688Target/);
  assert.match(source, /ALIBABA1688_OFFER_LOAD_TIMEOUT/);
  assert.match(source, /retryable: true/);
  for (const marker of ["404", "页面不存在", "找不到该页面", "商品已下架", "商品不存在", "货品已下架"]) {
    assert.match(ALIBABA1688_OFFER_PROBE_EXPRESSION, new RegExp(marker));
  }
  assert.match(ALIBABA1688_OFFER_PROBE_EXPRESSION, /notfound/);
  assert.doesNotMatch(source, /lastNavigationError[^\n]*OFFER_OFFLINE/);
});

test("a detected 1688 security challenge stops with a user-actionable error", () => {
  const source = draft([{
    barcode: "BBA1-1",
    supplierLink: "https://detail.1688.com/offer/732903613263.html",
    chinaOption: "단품",
    quantity: 10,
  }]);
  assert.throws(
    () => build1688CartPlan(source, [{
      offerId: "732903613263",
      blockedReason: "SECURITY_CHALLENGE",
      options: [],
    }]),
    {
      code: "ALIBABA1688_SECURITY_CHALLENGE",
      message: "열린 1688 전용 Chrome에서 보안 슬라이더 인증을 완료한 후 다시 실행하세요.",
    },
  );
});

test("1688 navigation clears only the display-language cookie before exact option matching", async () => {
  const source = await readFile(
    new URL("../local-agent/src/alibaba1688-cart-browser-adapter.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /Network\.deleteCookies/);
  assert.match(source, /name:\s*"oversealanguage"/);
  assert.match(source, /domain:\s*"\.1688\.com"/);
  assert.doesNotMatch(source, /Network\.clearBrowserCookies/);
  assert.match(source, /optionNames\.every/);
});

test("cart target selection toggles and verifies one exact checkbox at a time before checkout preview", async () => {
  const source = await readFile(
    new URL("../local-agent/src/alibaba1688-cart-browser-adapter.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /pending\.push\(checkbox\)/);
  assert.match(source, /checkbox\.click\(\)/);
  assert.match(source, /selectTargetsAndPreviewProbe\.toString\(\).*true/);
  assert.match(source, /selected\?\.code !== "TARGET_ROW_MATCH_COUNT_INVALID"/);
  assert.match(source, /selected\.checkboxClicks\?\.length > 0/);
  assert.match(source, /ALIBABA1688_TARGET_SELECTION_FAILED/);
  assert.match(source, /settlementButtonProbe\.toString\(\).*true/);
  assert.match(source, /ALIBABA1688_SETTLEMENT_CLICK_FAILED/);
});
