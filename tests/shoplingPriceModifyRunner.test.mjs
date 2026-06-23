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

test("request_id is generated with expected prefix and pattern", () => {
  const requestId = generateShoplingPriceModifyRequestId(new Date("2026-06-23T10:30:00Z"));
  assert.match(requestId, /^price-modify-/);
  assert.match(requestId, /^[A-Za-z0-9._:-]{1,120}$/);
});

test("dispatch payload includes goods_keys, request_id, batch 80 and does not expose token", async () => withEnv(baseEnv, async () => {
  const request = buildShoplingPriceModifyDispatchRequest("121031 121044");
  assert.equal(request.body.inputs.goods_keys, "121031,121044");
  assert.equal(request.body.inputs.batch, "80");
  assert.match(request.body.inputs.request_id, /^price-modify-/);
  assert.equal(JSON.stringify(request.body).includes("secret-token"), false);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /dispatches$/);
    assert.equal(JSON.parse(init.body).inputs.batch, "80");
    return new Response("", { status: 204 });
  };
  try {
    const result = await dispatchShoplingPriceModifyActions("121031");
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
  const combined = ui + await readFile(new URL("../src/lib/shoplingPriceModifyRunner.ts", import.meta.url), "utf8");
  assert.doesNotMatch(combined, /service account|raw ZIP|PowerShell|shell:\s*true|child_process\.exec/);
});
