import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import {
  buildShoplingPriceModifyActionsRunsUrl,
  buildShoplingPriceModifyDispatchRequest,
  dispatchShoplingPriceModifyActions,
  extractShoplingPriceModifyResultSummary,
  fetchShoplingPriceModifyActionsResult,
  generateShoplingPriceModifyRequestId,
  parseShoplingPriceModifyGoodsKeys,
  validateGoodsKeyGroupJson,
  validateShoplingPriceModifyPolicyOverrides,
} from "../src/lib/shoplingPriceModifyRunner.ts";

const ENV_KEYS = ["SHOPLING_PRICE_MODIFY_ENABLED", "SHOPLING_PRICE_MODIFY_REPO", "SHOPLING_PRICE_MODIFY_WORKFLOW", "SHOPLING_PRICE_MODIFY_REF", "SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN", "GITHUB_ACTIONS_TOKEN"];
function withEnv(env, fn) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  return Promise.resolve(fn()).finally(() => {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  });
}
const baseEnv = { SHOPLING_PRICE_MODIFY_ENABLED: "1", SHOPLING_PRICE_MODIFY_REPO: "andysong111/shopling-price-modify-auto", SHOPLING_PRICE_MODIFY_WORKFLOW: "shopling-price-modify.yml", SHOPLING_PRICE_MODIFY_REF: "main", SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN: "secret-token" };

test("goods_key parser accepts separators and removes duplicates", () => {
  assert.deepEqual(parseShoplingPriceModifyGoodsKeys("121031").goodsKeys, ["121031"]);
  assert.deepEqual(parseShoplingPriceModifyGoodsKeys("121031,121044,121045").goodsKeys, ["121031", "121044", "121045"]);
  assert.deepEqual(parseShoplingPriceModifyGoodsKeys("121031\n121044\n121045").goodsKeys, ["121031", "121044", "121045"]);
  assert.deepEqual(parseShoplingPriceModifyGoodsKeys("121031 121044 121045").goodsKeys, ["121031", "121044", "121045"]);
  assert.deepEqual(parseShoplingPriceModifyGoodsKeys("121031, 121031 121044").goodsKeys, ["121031", "121044"]);
});

test("goods_key parser rejects unsafe or invalid input", () => {
  for (const value of ["", "abc", "121031;rm", "121031 && echo test", "../file", "121031|whoami", '"121031"', "121031/1", "121031\\1"]) {
    assert.throws(() => parseShoplingPriceModifyGoodsKeys(value));
  }
});


test("policy override validation accepts valid policies and rejects unsafe values", () => {
  const valid = [{ mall_key: "SMALL_00001", multiplier: 1, add: 500, subtract: 0, round_up_unit: 10 }];
  assert.deepEqual(validateShoplingPriceModifyPolicyOverrides(valid), valid);
  for (const invalid of [
    [{ mall_key: "BAD", multiplier: 1, add: 500, subtract: 0, round_up_unit: 10 }],
    [...valid, ...valid],
    [{ mall_key: "SMALL_00001", multiplier: 0, add: 500, subtract: 0, round_up_unit: 10 }],
    [{ mall_key: "SMALL_00001", multiplier: 20, add: 500, subtract: 0, round_up_unit: 10 }],
    [{ mall_key: "SMALL_00001", multiplier: 1, add: -1, subtract: 0, round_up_unit: 10 }],
    [{ mall_key: "SMALL_00001", multiplier: 1, add: 500, subtract: -1, round_up_unit: 10 }],
    [{ mall_key: "SMALL_00001", multiplier: 1, add: 500, subtract: 0, round_up_unit: 7 }],
    [{ mall_key: "SMALL_00001", multiplier: 1, add: 500, subtract: 0, round_up_unit: 10, extra: true }],
    [{ mall_key: "SMALL_00001", multiplier: "1", add: 500, subtract: 0, round_up_unit: 10 }],
    { mall_key: "SMALL_00001", multiplier: 1, add: 500, subtract: 0, round_up_unit: 10 },
  ]) assert.throws(() => validateShoplingPriceModifyPolicyOverrides(invalid));
});

test("goods_key group json validation accepts six groups and rejects unsafe payloads", () => {
  assert.equal(validateGoodsKeyGroupJson(JSON.stringify({ "121207": "도매1", "121212": "소매2" })), JSON.stringify({ "121207": "도매1", "121212": "소매2" }));
  for (const invalid of ["[]", "{\"bad\":\"도매1\"}", "{\"121207\":\"전체\"}", 123]) {
    assert.throws(() => validateGoodsKeyGroupJson(invalid));
  }
});

test("request_id is generated with expected prefix and pattern", () => {
  const requestId = generateShoplingPriceModifyRequestId(new Date("2026-06-23T10:30:00Z"));
  assert.match(requestId, /^price-modify-/);
  assert.match(requestId, /^[A-Za-z0-9._:-]{1,120}$/);
});

test("dispatch payload includes goods_keys, request_id, batch 80, policy_overrides_json and does not expose token", async () => withEnv(baseEnv, async () => {
  const request = buildShoplingPriceModifyDispatchRequest("121031 121044");
  assert.equal(request.body.inputs.goods_keys, "121031,121044");
  assert.equal(request.body.inputs.batch, "80");
  assert.match(request.body.inputs.request_id, /^price-modify-/);
  assert.equal(request.body.inputs.policy_overrides_json, "");
  assert.equal(request.body.inputs.goods_key_group_json, "");
  assert.equal(request.body.inputs.base_consumer_price, "");
  assert.equal(request.body.inputs.base_sell_price, "");
  assert.equal(request.body.inputs.base_purchase_price, "");
  assert.equal(request.body.inputs.base_prices_json, "");
  assert.match(request.commandPreview, /policy_override_count=0/);
  const policy = [{ mall_key: "SMALL_00001", multiplier: 1, add: 500, subtract: 0, round_up_unit: 10 }];
  const requestWithMapping = buildShoplingPriceModifyDispatchRequest("121031", undefined, JSON.stringify({ "121031": "도매1" }));
  assert.equal(requestWithMapping.body.inputs.goods_key_group_json, JSON.stringify({ "121031": "도매1" }));
  assert.match(requestWithMapping.commandPreview, /goods_key_group_count=1/);
  const requestWithBasePrices = buildShoplingPriceModifyDispatchRequest("121031", undefined, undefined, { base_consumer_price: 15000, base_sell_price: "12000", base_purchase_price: "7000" });
  assert.equal(requestWithBasePrices.body.inputs.base_consumer_price, "15000");
  assert.equal(requestWithBasePrices.body.inputs.base_sell_price, "12000");
  assert.equal(requestWithBasePrices.body.inputs.base_purchase_price, "7000");
  assert.match(requestWithBasePrices.commandPreview, /base_price_inputs=3/);
  const requestWithPolicy = buildShoplingPriceModifyDispatchRequest("121031", policy);
  assert.equal(requestWithPolicy.body.inputs.policy_overrides_json, JSON.stringify(policy));
  assert.match(requestWithPolicy.commandPreview, /policy_override_count=1/);
  assert.equal(JSON.stringify(request.body).includes("secret-token"), false);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /dispatches$/);
    assert.equal(JSON.parse(init.body).inputs.batch, "80");
    assert.equal(Object.hasOwn(JSON.parse(init.body).inputs, "policy_overrides_json"), true);
    const inputs = JSON.parse(init.body).inputs;
    assert.equal(Object.hasOwn(inputs, "goods_key_group_json"), true);
    assert.equal(inputs.base_consumer_price, "15000");
    assert.equal(inputs.base_sell_price, "12000");
    assert.equal(inputs.base_purchase_price, "7000");
    return new Response("", { status: 204 });
  };
  try {
    const result = await dispatchShoplingPriceModifyActions("121031", undefined, undefined, { base_consumer_price: "15000", base_sell_price: "12000", base_purchase_price: "7000" });
    assert.equal(result.status, "queued");
    assert.equal(JSON.stringify(result).includes("secret-token"), false);
  } finally { globalThis.fetch = oldFetch; }
}));

test("result fetch builds workflow runs URL and validates env/request_id", async () => withEnv(baseEnv, async () => {
  assert.match(buildShoplingPriceModifyActionsRunsUrl(20).url, /actions\/workflows\/shopling-price-modify\.yml\/runs\?branch=main&event=workflow_dispatch&per_page=20/);
  const invalid = await fetchShoplingPriceModifyActionsResult("bad/slash");
  assert.equal(invalid.status, "error");
  delete process.env.SHOPLING_PRICE_MODIFY_REPO;
  const missing = await fetchShoplingPriceModifyActionsResult();
  assert.equal(missing.status, "error");
}));

test("extracts result_summary.json from root, exact, and nested paths", () => {
  const summary = { request_id: "price-modify-x", ok_count: 24, fail_count: 0 };
  for (const path of ["result_summary.json", "output/github_actions/result_summary.json", "nested/result_summary.json"]) {
    const zip = zipSync({ [path]: strToU8(JSON.stringify(summary)) });
    assert.equal(extractShoplingPriceModifyResultSummary(zip).request_id, "price-modify-x");
  }
});

test("result fetch matches request_id, returns pending, and latest fallback works", async () => withEnv(baseEnv, async () => {
  const zip = zipSync({ "output/github_actions/result_summary.json": strToU8(JSON.stringify({ request_id: "price-modify-match", ok_count: 24, fail_count: 0 })) });
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/runs?")) return Response.json({ workflow_runs: [{ id: 1, status: "completed", conclusion: "success", html_url: "https://github.test/run/1" }] });
    if (text.endsWith("/artifacts")) return Response.json({ artifacts: [{ name: "shopling-price-modify-result-summary", archive_download_url: "https://download.test/artifact.zip" }] });
    return new Response(zip, { status: 200 });
  };
  try {
    assert.equal((await fetchShoplingPriceModifyActionsResult("price-modify-match")).status, "success");
    assert.equal((await fetchShoplingPriceModifyActionsResult("price-modify-other")).status, "pending");
    assert.equal((await fetchShoplingPriceModifyActionsResult()).requestId, "price-modify-match");
  } finally { globalThis.fetch = oldFetch; }
}));

test("UI source includes required labels, localStorage key, and security-sensitive omissions", async () => {
  const { readFile } = await import("node:fs/promises");
  const ui = await readFile(new URL("../src/components/shopling-price-modify-runner/ShoplingPriceModifyRunner.tsx", import.meta.url), "utf8");
  for (const text of [
    "샵플링 goods_key",
    "가격설정 실행",
    "최근 실행 결과 가져오기",
    "요청 추적 ID",
    "성공 수",
    "실패 수",
    "idx",
    "mall",
    "goods_key",
    "code",
    "msg",
    "shoplingPriceModify.currentRequestId",
    "기준 가격 입력",
    "기준 소비자가",
    "기준 판매가",
    "기준 매입가",
    "기준 매입가(원가)",
    "독립 가격설정은 goods_key만으로 소비자가/매입가를 안전하게 알 수 없는 경우가 있습니다.",
    "독립 가격설정은 기준 소비자가/판매가/매입가를 입력해야 합니다.",
    "base_consumer_price",
    "base_sell_price",
    "base_purchase_price",
    "소비자가 입력",
    "판매가 입력",
    "매입가 입력",
    "three_column_payload_count",
    "missing_consumer_price_count",
    "missing_purchase_price_count",
    "blocked_missing_base_price_count",
    "커스텀 가격정책",
    "커스텀 정책 추가",
    "쇼핑몰 선택",
    "곱하기",
    "더하기",
    "빼기",
    "올림단위",
    "계산식: 기본 판매가 × 곱하기 + 더하기 - 빼기",
    "적용 쇼핑몰 및 가격 정책 보기",
    "적용 쇼핑몰 및 가격 정책 접기",
    "policy_override_count",
    "policy_overrides",
    "쇼핑몰명",
    "커스텀 가격정책이 없습니다. 기본 정책으로 실행되었습니다.",
    "적용 쇼핑몰 및 가격 정책",
    "카페24(1.9)",
    "SMALL_00014",
    "판매가 × 0.97 후 10원 단위 올림",
    "도매창고",
    "SMALL_00071",
    "판매가 + 500원",
    "에이블리",
    "SMALL_00112",
    "판매가 + 3,000원",
    "옥션",
    "쿠팡",
    "롯데ON",
    "TEMU",
    "실제 가격설정 스크립트가 수정하는 24개 쇼핑몰만 표시합니다.",
  ]) assert.ok(ui.includes(text), `Expected UI source to include ${text}`);
  const route = await readFile(new URL("../src/app/api/shopling-price-modify/run/route.ts", import.meta.url), "utf8");
  for (const text of ["base_consumer_price", "base_sell_price", "base_purchase_price", "base_prices_json", "dispatchShoplingPriceModifyActions"]) assert.ok(route.includes(text), `Expected API route to include ${text}`);
  const combined = ui + await readFile(new URL("../src/lib/shoplingPriceModifyRunner.ts", import.meta.url), "utf8") + route;
  for (const secretText of ["API_AUTH_KEY", "LOGIN_PASSWORD"]) assert.equal(combined.includes(secretText), false);
  assert.doesNotMatch(combined, /service account|raw ZIP|PowerShell|shell:\s*true|child_process\.exec|child_process|exec\(/);
});
