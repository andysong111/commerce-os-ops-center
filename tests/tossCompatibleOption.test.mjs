import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeTossCompatibleOptionRows } from "../src/lib/tossCompatibleOption.ts";

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

test("기존 데이터에 한 개의 이질값이 섞여도 명확한 다수 의미를 범용 '옵션'보다 우선한다", () => {
  const colorDominant = normalizeTossCompatibleOptionRows([
    { optionName: "옵션", saleOption: "블랙" },
    { optionName: "옵션", saleOption: "화이트" },
    { optionName: "옵션", saleOption: "대형" },
  ]);
  assert.equal(colorDominant.optionName, "색상");

  const sizeDominant = normalizeTossCompatibleOptionRows([
    { optionName: "구성", saleOption: "소형" },
    { optionName: "구성", saleOption: "대형" },
    { optionName: "구성", saleOption: "블랙" },
  ]);
  assert.equal(sizeDominant.optionName, "사이즈");
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

test("Product Master 자동옵션과 샵플링 최종 payload 양쪽 모두 토스 정규화기를 통과한다", () => {
  const modelOptionsSource = readFileSync(
    new URL("../src/app/api/product-launch-tracker/model-order-options/route.ts", import.meta.url),
    "utf8",
  );
  const payloadSource = readFileSync(
    new URL("../src/lib/productLaunchTrackerShopling.ts", import.meta.url),
    "utf8",
  );

  assert.match(modelOptionsSource, /normalizeTossCompatibleOptionRows\(/);
  assert.match(modelOptionsSource, /source: "product_master_planning_snapshot"/);
  assert.match(modelOptionsSource, /optionNormalization: "toss_compatible_v1"/);
  assert.doesNotMatch(modelOptionsSource, /optionName:\s*["']옵션["']/);
  assert.match(payloadSource, /normalizeTossCompatibleOptionRows\(/);
  assert.doesNotMatch(payloadSource, /text\(option\.optionName\)\s*\|\|\s*["']옵션["']/);
  assert.match(payloadSource, /토스 호환 옵션 사전검증 실패/);
});
