import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTossCompatibleOptionRows } from "../src/lib/tossCompatibleOption.ts";
import { buildProductLaunchShoplingPayload } from "../src/lib/productLaunchTrackerShopling.ts";

function option(barcode, optionBarcodeNo, saleOption, optionName = "옵션") {
  return {
    optionName,
    saleOption,
    barcode,
    optionBarcodeNo,
    baseSalePriceKrw: 10000,
    unitCostKrw: 3000,
  };
}

function launchItem(orderOptions) {
  return {
    id: "launch-toss-option-test",
    modelNumber: "AAA999",
    productName: "테스트 상품",
    shoplingCategory: "생활 > 테스트",
    selfCodeBase: "AAA999",
    barcode: orderOptions.length === 1 ? orderOptions[0].barcode : "",
    detailPageAsset: {
      html: "<p>상세설명</p>",
      mainImageUrl: "https://example.com/main.jpg",
      additionalImageUrls: [],
    },
    orderOptions,
  };
}

test("기존 범용 옵션명은 색상 값 집합을 토스 호환 '색상'으로 바꾼다", () => {
  const result = normalizeTossCompatibleOptionRows([
    { optionName: "옵션", saleOption: "블랙" },
    { optionName: "옵션", saleOption: "화이트" },
  ]);

  assert.equal(result.optionName, "색상");
  assert.deepEqual(
    result.rows.map((row) => [row.optionName, row.saleOption]),
    [["색상", "블랙"], ["색상", "화이트"]],
  );
});

test("'구성: 2개입'처럼 수량 의미가 명확하면 토스 호환 '수량'으로 바꾼다", () => {
  const result = normalizeTossCompatibleOptionRows([
    { optionName: "구성", saleOption: "2개입" },
  ]);
  assert.equal(result.optionName, "수량");
  assert.equal(result.rows[0].saleOption, "2개입");
});

test("사이즈 값과 단품은 각각 사이즈와 단품으로 정규화한다", () => {
  const sizeResult = normalizeTossCompatibleOptionRows([
    { optionName: "옵션", saleOption: "소형" },
    { optionName: "옵션", saleOption: "대형" },
  ]);
  assert.equal(sizeResult.optionName, "사이즈");

  const singleResult = normalizeTossCompatibleOptionRows([
    { optionName: "옵션", saleOption: "단품" },
  ]);
  assert.equal(singleResult.optionName, "단품");
  assert.equal(singleResult.rows[0].saleOption, "단품");
});

test("이미 의미 있는 옵션명은 그대로 존중하고 값 앞의 의미 접두사는 분리한다", () => {
  const result = normalizeTossCompatibleOptionRows([
    { optionName: "옵션", saleOption: "색상: 화이트" },
    { optionName: "옵션", saleOption: "색상: 블랙" },
  ]);
  assert.equal(result.optionName, "색상");
  assert.deepEqual(result.rows.map((row) => row.saleOption), ["화이트", "블랙"]);
});

test("의미를 확정할 수 없는 혼합 구성은 범용 '옵션'으로 보내지 않고 차단한다", () => {
  assert.throws(
    () => normalizeTossCompatibleOptionRows([
      { optionName: "옵션", saleOption: "펀칭기계만" },
      { optionName: "옵션", saleOption: "단추만50개" },
    ]),
    /토스 호환 옵션명을 자동 확정할 수 없습니다/,
  );
});

test("동일 옵션값 중복은 구매 조합 충돌을 막기 위해 차단한다", () => {
  assert.throws(
    () => normalizeTossCompatibleOptionRows([
      { optionName: "옵션", saleOption: "핑크" },
      { optionName: "옵션", saleOption: "핑크" },
    ]),
    /동일한 옵션값이 중복되었습니다/,
  );
});

test("샵플링 최종 payload에도 범용 옵션명이 남지 않고 모든 채널에 같은 토스 호환 옵션이 전달된다", () => {
  const payload = buildProductLaunchShoplingPayload(
    launchItem([
      option("BAA1-1", "123456789001", "블랙"),
      option("BAA1-2", "123456789002", "화이트"),
    ]),
    {},
    "toss-option-test-request",
  );

  assert.equal(payload.channels.length, 6);
  for (const channel of payload.channels) {
    assert.deepEqual(
      channel.options.map((row) => [row.optionName, row.saleOption]),
      [["색상", "블랙"], ["색상", "화이트"]],
    );
  }
});

test("샵플링 최종 payload 생성 직전에도 애매한 옵션을 fail-closed 한다", () => {
  assert.throws(
    () => buildProductLaunchShoplingPayload(
      launchItem([
        option("BAA1-1", "123456789001", "펀칭기계만"),
        option("BAA1-2", "123456789002", "단추만50개"),
      ]),
      {},
      "toss-option-ambiguous-test",
    ),
    /토스 호환 옵션 사전검증 실패/,
  );
});
