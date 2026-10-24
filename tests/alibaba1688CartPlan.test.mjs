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
  buildAlibaba1688CheckoutProbeExpression,
  chooseAlibaba1688ShippingPreference,
  doesAlibaba1688TextMatchOptions,
  filterAlibaba1688LeafOptionDescriptors,
  mergeAlibaba1688CartLineSnapshots,
  normalizeAlibaba1688OptionText,
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
  const deferred = build1688CartPlan(source, [{ ...inspection[0], options: inspection[0].options.slice(0, 1) }]);
  assert.deepEqual(deferred.items[0].optionNames, ["透明 精灵耳贴【硅胶】", "60贴袋装"]);
});

test("multiple requested axes can resolve to one unique combined 1688 SKU label", () => {
  const source = draft([{
    barcode: "BAB2-1",
    supplierLink: "https://detail.1688.com/offer/831228648371.html",
    chinaOption: "水豚啪啪圈,23cm左右",
    quantity: 50,
  }]);
  const plan = build1688CartPlan(source, [{
    offerId: "831228648371",
    options: [{ name: "水豚啪啪圈 23cm左右", purchasable: true }],
  }]);
  assert.deepEqual(plan.items[0].optionNames, ["水豚啪啪圈 23cm左右"]);
  assert.equal(plan.items[0].optionName, "水豚啪啪圈 23cm左右");
  assert.equal(plan.items[0].quantity, 50);
});

test("an approximate legacy size resolves to the unique current size while preserving a leaf option inside a group", () => {
  const source = draft([{
    barcode: "BAB2-1",
    supplierLink: "https://detail.1688.com/offer/831228648371.html",
    chinaOption: "水豚啪啪圈,23cm左右",
    quantity: 50,
  }]);
  const plan = build1688CartPlan(source, [{
    offerId: "831228648371",
    options: [
      { name: "颜色薯条背包款背乌龟款鼻涕款糖葫芦款鸭子款吐司款头顶蜜蜂款围巾款生日帽款HAPPY款汉堡款草莓帽款戴帽子汉堡款挂件款水豚背龟挂件款水豚啪啪圈水豚背龟啪啪圈好柿发生水豚哪吒水豚" },
      { name: "25厘米【0.15kg】" },
      { name: "30厘米【0.28kg】" },
    ],
  }]);
  assert.deepEqual(plan.items[0].optionNames, ["水豚啪啪圈", "25厘米【0.15kg】"]);
  assert.equal(plan.items[0].optionName, "水豚啪啪圈,25厘米【0.15kg】");
});

test("a precise multi-axis size is preserved for exact browser validation instead of silently changed", () => {
  const source = draft([{
    barcode: "BAB2-1",
    supplierLink: "https://detail.1688.com/offer/831228648371.html",
    chinaOption: "水豚啪啪圈,23cm",
    quantity: 50,
  }]);
  const plan = build1688CartPlan(source, [{
    offerId: "831228648371",
    options: [{ name: "水豚啪啪圈" }, { name: "25厘米【0.15kg】" }],
  }]);
  assert.deepEqual(plan.items[0].optionNames, ["水豚啪啪圈", "23cm"]);
});

test("a dynamic second-axis option missing from the default preflight rows is deferred to browser validation", () => {
  const source = draft([{
    barcode: "BAB2-1",
    supplierLink: "https://detail.1688.com/offer/831228648371.html",
    chinaOption: "啪啪圈水豚,10厘米【0.09kg】",
    quantity: 50,
  }]);
  const plan = build1688CartPlan(source, [{
    offerId: "831228648371",
    options: [
      { name: "颜色薯条背包款背乌龟款鼻涕款糖葫芦款鸭子款吐司款头顶蜜蜂款围巾款生日帽款HAPPY款汉堡款草莓帽款戴帽子汉堡款挂件款水豚背龟挂件款水豚啪啪圈水豚背龟啪啪圈好柿发生水豚哪吒水豚" },
      { name: "25厘米【0.15kg】" },
      { name: "30厘米【0.28kg】" },
    ],
  }]);
  assert.deepEqual(plan.items[0].optionNames, ["啪啪圈水豚", "10厘米【0.09kg】"]);
});

test("a missing single-axis option still fails closed during preflight", () => {
  const source = draft([{
    barcode: "BAB2-1",
    supplierLink: "https://detail.1688.com/offer/831228648371.html",
    chinaOption: "23cm",
    quantity: 50,
  }]);
  let captured;
  try {
    build1688CartPlan(source, [{
      offerId: "831228648371",
      url: "https://detail.1688.com/offer/831228648371.html",
      options: [{ name: "25厘米【0.15kg】" }],
    }]);
  } catch (error) {
    captured = error;
  }
  assert.equal(captured?.code, "ALIBABA1688_OPTION_NOT_FOUND");
  assert.equal(captured?.details?.requestedOption, "23cm");
  assert.deepEqual(captured?.details?.availableOptions, ["25厘米【0.15kg】"]);
  assert.equal(captured?.details?.optionSelectionRequired, true);
});

test("an empty preflight option scrape is deferred to exact browser validation", () => {
  const source = draft([{
    barcode: "BDB6-2",
    supplierLink: "https://detail.1688.com/offer/668850156055.html",
    chinaOption: "女袜+按摩棒",
    quantity: 20,
  }]);
  const plan = build1688CartPlan(source, [{
    offerId: "668850156055",
    url: "https://detail.1688.com/offer/668850156055.html",
    canAdd: true,
    options: [],
  }]);
  assert.deepEqual(plan.items[0].optionNames, ["女袜+按摩棒"]);
});

test("a sole generic size is combined with the saved color or style axis", () => {
  const source = draft([{
    barcode: "BGE1-1",
    supplierLink: "https://detail.1688.com/offer/725455552479.html",
    chinaOption: "九扣披肩黑色",
    quantity: 20,
  }]);
  const plan = build1688CartPlan(source, [{
    offerId: "725455552479",
    url: "https://detail.1688.com/offer/725455552479.html",
    canAdd: true,
    options: [{ name: "均码", purchasable: true }],
  }]);
  assert.deepEqual(plan.items[0].optionNames, ["九扣披肩黑色", "均码"]);
});

test("contained option matching remains blocked when more than one purchasable label matches", () => {
  const source = draft([{
    barcode: "BAB2-1",
    supplierLink: "https://detail.1688.com/offer/831228648371.html",
    chinaOption: "水豚啪啪圈,23cm左右",
    quantity: 50,
  }]);
  let captured;
  try {
    build1688CartPlan(source, [{
      offerId: "831228648371",
      options: [
        { name: "水豚啪啪圈 23cm左右", purchasable: true },
        { name: "水豚啪啪圈 30cm左右", purchasable: true },
      ],
    }]);
  } catch (error) {
    captured = error;
  }
  assert.equal(captured?.code, "ALIBABA1688_OPTION_AMBIGUOUS");
  assert.equal(captured?.details?.requestedOption, "水豚啪啪圈");
  assert.deepEqual(captured?.details?.availableOptions, ["水豚啪啪圈 23cm左右", "水豚啪啪圈 30cm左右"]);
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
  let captured;
  try {
    build1688CartPlan(source, [{ offerId: "843297532637", options: [{ name: "红" }, { name: "蓝" }] }]);
  } catch (error) {
    captured = error;
  }
  assert.equal(captured?.code, "ALIBABA1688_SINGLE_OPTION_AMBIGUOUS");
  assert.equal(captured?.details?.offerUrl, "https://detail.1688.com/offer/843297532637.html");
  assert.deepEqual(captured?.details?.availableOptions, ["红", "蓝"]);
  assert.equal(captured?.details?.optionSelectionRequired, true);
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

test("post-cart save records the current matched 1688 option on the draft", () => {
  const source = draft([{
    barcode: "BAB2-1",
    supplierLink: "https://detail.1688.com/offer/831228648371.html",
    chinaOption: "水豚啪啪圈,23cm左右",
    quantity: 50,
  }]);
  const plan = build1688CartPlan(source, [{
    offerId: "831228648371",
    options: [
      { name: "颜色薯条背包款水豚啪啪圈水豚背龟啪啪圈好柿发生水豚" },
      { name: "25厘米【0.15kg】" },
      { name: "30厘米【0.28kg】" },
    ],
  }]);
  const lines = buildDraftLinesFrom1688Checkout(source, plan, {
    lines: [{
      offerId: "831228648371",
      optionName: "水豚啪啪圈,25厘米【0.15kg】",
      quantity: 50,
      unitPriceCny: 2.1,
      groupId: "seller-capybara",
    }],
    sellerGroups: [{ groupId: "seller-capybara", domesticFreightCny: 8 }],
  });
  assert.equal(lines[0].chinaOption, "水豚啪啪圈,25厘米【0.15kg】");
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

test("browser adapter exposes checkout preview but no order submission or payment action", async () => {
  const source = await readFile("local-agent/src/alibaba1688-cart-browser-adapter.mjs", "utf8");
  assert.match(source, /readCheckoutPreview/);
  assert.doesNotMatch(source, /submitCheckoutOrder|checkoutSubmitOrderProbe|paymentSelectionProbe/);
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
  assert.match(source, /button\.sku-filter-button/);
  assert.match(source, /optionSelectionRequired: availableOptions\.length > 0/);
  assert.match(source, /selectedExternalOptions/);
  assert.match(source, /Input\.insertText/);
  assert.match(source, /Trusted CDP text input then replaces the whole value/);
  assert.match(source, /Input\.dispatchMouseEvent/);
  assert.match(source, /QUANTITY_STATE_STABILIZATION_FAILED/);
  assert.match(source, /adjust\("plus", "minus"\)/);
  assert.match(source, /tr\[data-cart-id\]/);
  assert.match(source, /input\[aria-valuemin\]\[aria-valuemax\]/);
  assert.match(source, /scanAlibaba1688CartViewport/);
  assert.match(source, /\^\(\?:可售\)\?库存/);
});

test("1688 option discovery excludes an axis container that concatenates its child option names", async () => {
  assert.deepEqual(filterAlibaba1688LeafOptionDescriptors([
    { name: "颜色灰色粉色白色", hasNestedOption: true },
    { name: "灰色", hasNestedOption: false },
    { name: "粉色", hasNestedOption: false },
    { name: "白色", hasNestedOption: false },
    { name: "30*30", hasNestedOption: false },
    { name: "45*45", hasNestedOption: false },
  ]).map((entry) => entry.name), ["灰色", "粉色", "白色", "30*30", "45*45"]);

  const source = await readFile(
    new URL("../local-agent/src/alibaba1688-cart-browser-adapter.mjs", import.meta.url),
    "utf8",
  );
  const perSkuProbeSource = source.slice(
    source.indexOf("async function preparePerSkuQuantityProbe"),
    source.indexOf("function cartSnapshotProbe"),
  );
  assert.match(ALIBABA1688_OFFER_PROBE_EXPRESSION, /hasNestedOption/);
  assert.match(ALIBABA1688_OFFER_PROBE_EXPRESSION, /颜色\(\?:分类\)\?/);
  assert.match(perSkuProbeSource, /labels: readOptionLabels\(row\)/);
  assert.match(source, /browserProbeExpression\(preparePerSkuQuantityProbe/);
  assert.match(perSkuProbeSource, /const axisHeading = \/\^\(\?:颜色/);
  assert.match(perSkuProbeSource, /entry\.labels\.some\(\(label\) => sameOption\(label, optionName\)\)/);
  assert.doesNotMatch(perSkuProbeSource, /normalizedText\.includes\(normalize\(optionName\)\)/);
});

test("1688 cart option matching treats common dimension multiplication marks as the same option", () => {
  assert.equal(normalize1688OptionName("灰色, 45×45"), "灰色,45*45");
  assert.equal(normalizeAlibaba1688OptionText("规格：45 x 45 cm"), "规格:45*45 cm");
  assert.equal(doesAlibaba1688TextMatchOptions("颜色：灰色 规格：45×45", ["灰色", "45*45"], 2), true);
  assert.equal(doesAlibaba1688TextMatchOptions("颜色：粉色 规格：45×45", ["灰色", "45*45"], 2), false);
});

test("cart snapshots from virtualized scroll windows merge without duplicating the same line", () => {
  const first = { offerId: "100", optionName: "灰色,45*45", quantity: 10, lineMarker: "line-1" };
  const second = { offerId: "200", optionName: "男袜+按摩棒", quantity: 20, lineMarker: "line-2" };
  assert.deepEqual(mergeAlibaba1688CartLineSnapshots([
    { lines: [first] },
    { lines: [first, second] },
    { lines: [{ ...first, quantity: 12 }] },
  ]), [{ ...first, quantity: 12 }, second]);
});

test("per-SKU add control is clicked in the same trusted user gesture after quantity stabilization", async () => {
  const source = await readFile(
    new URL("../local-agent/src/alibaba1688-cart-browser-adapter.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /addButtons\[0\]\.scrollIntoView/);
  assert.match(source, /ADD_CONTROL_OUTSIDE_VIEWPORT/);
  assert.match(source, /Runtime\.evaluate is invoked with userGesture=true/);
  assert.match(source, /addButtons\[0\]\.click\(\)/);
  assert.match(source, /scanAlibaba1688CartViewport/);
  assert.match(source, /cartViewportProbe/);
  assert.match(source, /matchedKeys\.size !== keyedItems\.length/);
});

test("offer inspection recognizes the Korean 1688 slider security challenge", () => {
  for (const label of ["슬라이더", "보안 인증", "인증을 완료", "밀어서 확인", "정상 접속"]) {
    assert.match(ALIBABA1688_OFFER_PROBE_EXPRESSION, new RegExp(label));
  }
});

test("task 5 hands a blocked offer to the operator without opening or foregrounding a dedicated window", async () => {
  const source = await readFile(
    new URL("../local-agent/src/alibaba1688-cart-browser-adapter.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /SECURITY_CHALLENGE_WAIT_MS/);
  assert.match(source, /challengeFailed/);
  assert.doesNotMatch(source, /SECURITY_CHALLENGE_FRESH_TARGET_RETRIES/);
  assert.doesNotMatch(source, /freshTargetRequired/);
  assert.doesNotMatch(source, /Page\.reload/);
  assert.doesNotMatch(source, /waitForOfferSecurityChallenge/);
  assert.doesNotMatch(source, /Target\.createTarget/);
  assert.doesNotMatch(source, /newWindow:\s*true/);
  assert.doesNotMatch(source, /activateChromeTarget/);
  assert.match(source, /const target = await ensure1688Target\(config, unique\[0\]\?\.offerUrl \|\| CART_URL, dependencies\)/);
  assert.match(source, /timeoutMs: OFFER_NAVIGATION_TIMEOUT_MS/);
});

test("a rejected 1688 captcha requires a manual browser handoff", () => {
  const source = draft([{
    barcode: "BBA1-1",
    supplierLink: "https://detail.1688.com/offer/732903613263.html",
    chinaOption: "단품",
    quantity: 10,
  }]);
  let captured;
  try {
    build1688CartPlan(source, [{
      offerId: "732903613263",
      blockedReason: "SECURITY_CHALLENGE",
      challengeFailed: true,
      options: [],
    }]);
  } catch (error) {
    captured = error;
  }
  assert.equal(captured?.code, "ALIBABA1688_AUTOMATION_SESSION_REJECTED");
  assert.equal(captured?.details?.barcode, "BBA1-1");
  assert.equal(captured?.details?.offerUrl, "https://detail.1688.com/offer/732903613263.html");
  assert.deepEqual(captured?.details?.manualItems, [{ chinaOption: "단품", quantity: 10 }]);
  assert.equal(captured?.details?.manualHandoffRequired, true);
  assert.match(captured?.message || "", /일반 Chrome으로 상품 링크를 열고 보안인증을 완료하면 자동 작업을 이어갑니다/);
});

test("slow 1688 offer loading is retried and only explicit 404 or down markers mean offline", async () => {
  const source = await readFile(
    new URL("../local-agent/src/alibaba1688-cart-browser-adapter.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /OFFER_NAVIGATION_TIMEOUT_MS = 60_000/);
  assert.match(source, /OFFER_RETRY_COUNT = 2/);
  assert.match(source, /const target = await ensure1688Target\(config, unique\[0\]\?\.offerUrl \|\| CART_URL, dependencies\)/);
  assert.match(source, /const target = lastTarget \|\| await ensure1688Target/);
  assert.match(source, /ALIBABA1688_OFFER_LOAD_TIMEOUT/);
  assert.match(source, /barcode: Array\.isArray\(item\.barcodes\)/);
  assert.match(source, /offerUrl: item\.offerUrl/);
  assert.match(source, /retryable: true/);
  for (const marker of ["404", "页面不存在", "找不到该页面", "商品已下架", "商品不存在", "货品已下架"]) {
    assert.match(ALIBABA1688_OFFER_PROBE_EXPRESSION, new RegExp(marker));
  }
  assert.match(ALIBABA1688_OFFER_PROBE_EXPRESSION, /notfound/);
  assert.doesNotMatch(source, /lastNavigationError[^\n]*OFFER_OFFLINE/);
});

test("late sku-filter-button options are discovered before an offer is treated as optionless", async () => {
  const source = await readFile(
    new URL("../local-agent/src/alibaba1688-cart-browser-adapter.mjs", import.meta.url),
    "utf8",
  );
  assert.match(ALIBABA1688_OFFER_PROBE_EXPRESSION, /button\.sku-filter-button/);
  assert.match(source, /stableOptionlessAddProbeCount >= 3/);
  assert.match(source, /value\.options\.length > 0/);
  assert.match(source, /attempt < 10/);
  assert.match(source, /candidates\.length !== 0 \|\| attempt === 9/);
  assert.match(source, /rows\.length !== 0 \|\| attempt === 9/);
});

test("disabled quantity rows remain available while an external style option is selected", async () => {
  const source = await readFile(
    new URL("../local-agent/src/alibaba1688-cart-browser-adapter.mjs", import.meta.url),
    "utf8",
  );
  const perSkuProbeSource = source.slice(
    source.indexOf("async function preparePerSkuQuantityProbe"),
    source.indexOf("async function clickPreparedPerSkuAddProbe"),
  );
  assert.match(perSkuProbeSource, /const readRows = \(includeDisabled = false\)/);
  assert.match(perSkuProbeSource, /includeDisabled \|\| !entry\.input\.disabled/);
  assert.match(perSkuProbeSource, /rows = readRows\(true\)/);
  assert.match(perSkuProbeSource, /Selecting an external style\/color hydrates and enables/);
  assert.match(perSkuProbeSource, /rows = readRows\(\)/);
  assert.ok(
    perSkuProbeSource.indexOf("candidates[0].click()")
      < perSkuProbeSource.indexOf("return { handled: false };"),
  );
  assert.match(source, /const selectors = "button\.sku-filter-button,\[class\*='sku-filter-button'\]/);
  assert.match(perSkuProbeSource, /code: "OPTION_UNAVAILABLE"/);
  assert.match(perSkuProbeSource, /const renderedRows = Array\.from\(document\.querySelectorAll\("\.expand-view-item"\)\)\.filter\(visible\)/);
  assert.match(perSkuProbeSource, /availableOptions: \[\.\.\.new Set\(availableOptions\)\]/);
  assert.match(perSkuProbeSource, /selectedExternalElements\.at\(-1\)\?\.click\(\)/);
});

test("a detected 1688 security challenge includes the same one-click link handoff", () => {
  const source = draft([{
    barcode: "BBA1-1",
    supplierLink: "https://detail.1688.com/offer/732903613263.html",
    chinaOption: "단품",
    quantity: 10,
  }]);
  let captured;
  try {
    build1688CartPlan(source, [{
      offerId: "732903613263",
      blockedReason: "SECURITY_CHALLENGE",
      options: [],
    }]);
  } catch (error) {
    captured = error;
  }
  assert.equal(captured?.code, "ALIBABA1688_SECURITY_CHALLENGE");
  assert.equal(captured?.details?.manualHandoffRequired, true);
  assert.equal(captured?.details?.offerUrl, "https://detail.1688.com/offer/732903613263.html");
  assert.match(captured?.message || "", /일반 Chrome으로 상품 링크를 열고 보안인증을 완료하면 자동 작업을 이어갑니다/);
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
  assert.match(source, /browserProbeExpression\(selectTargetsAndPreviewProbe,.*true/);
  assert.match(source, /matchedKeys\.add/);
  assert.match(source, /selected\?\.checkboxClicks\?\.length > 0/);
  assert.match(source, /ALIBABA1688_TARGET_SELECTION_FAILED/);
  assert.match(source, /settlementButtonProbe\.toString\(\).*true/);
  assert.match(source, /ALIBABA1688_SETTLEMENT_CLICK_FAILED/);
});
