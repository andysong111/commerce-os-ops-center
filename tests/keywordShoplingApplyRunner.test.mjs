import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { zipSync, strToU8 } from "fflate";
import {
  buildKeywordShoplingApplyDispatchRequest,
  extractKeywordShoplingApplyArtifact,
} from "../src/lib/keywordShoplingApplyRunner.ts";

function withEnv(fn) {
  const old = { ...process.env };
  process.env.KEYWORD_SHOPLING_APPLY_ENABLED = "1";
  process.env.KEYWORD_SHOPLING_APPLY_REPO = "andysong111/andysong111-keyword-engine-soon";
  process.env.KEYWORD_SHOPLING_APPLY_WORKFLOW = "keyword-shopling-apply.yml";
  process.env.KEYWORD_SHOPLING_APPLY_REF = "main";
  process.env.KEYWORD_SHOPLING_APPLY_ACTIONS_TOKEN = "ghp_test_token";
  try { return fn(); } finally { process.env = old; }
}
const plan = JSON.stringify({ eligibleItems: [{ goods_key: "1" }], blockedItems: [], summary: {} });

test("dry_run dispatch request includes dry_run and safe preview", () => withEnv(() => {
  const req = buildKeywordShoplingApplyDispatchRequest({ execution_plan_json: plan, mode: "dry_run", confirmation_text: "", max_items: 20 });
  assert.equal(req.body.inputs.mode, "dry_run");
  assert.equal(req.body.inputs.execution_plan_json, plan);
  assert.match(req.commandPreview, /mode=dry_run/);
  assert.match(req.commandPreview, /item_count=1/);
  assert.doesNotMatch(req.commandPreview, /eligibleItems|execution_plan_json/);
  assert.equal("token" in JSON.parse(JSON.stringify({ ...req, token: undefined })), false);
}));

test("apply dispatch requires exact confirmation", () => withEnv(() => {
  assert.throws(() => buildKeywordShoplingApplyDispatchRequest({ execution_plan_json: plan, mode: "apply", confirmation_text: "wrong", max_items: 20 }), /확인문구/);
  const req = buildKeywordShoplingApplyDispatchRequest({ execution_plan_json: plan, mode: "apply", confirmation_text: "APPLY_KEYWORD_RESULTS_TO_SHOPLING", max_items: 20 });
  assert.equal(req.body.inputs.mode, "apply");
}));

test("artifact parsing extracts nested JSON/JSONL and omits raw XML/secrets", () => {
  const zip = zipSync({
    "output/shopling_apply/result_summary.json": strToU8(JSON.stringify({ request_id: "keyword-apply-1", mode: "dry_run", status: "ok", input_item_count: 1, request_xml: "<secret/>", credentials: "x", env: { A: 1 } })),
    "output/shopling_apply/apply_results.jsonl": strToU8(JSON.stringify({ goods_key: "1", mall_key: "m", title_update_status: "ok", request_xml: "<x/>", API_KEY: "secret" }) + "\n"),
    "output/shopling_apply/verify_results.jsonl": strToU8(JSON.stringify({ goods_key: "1", mall_key: "m", site_srch_update_status: "ok" }) + "\n"),
    "output/shopling_apply/blocked_items.jsonl": strToU8(JSON.stringify({ goods_key: "2", mall_key: "m", reasons: ["NO"] }) + "\n"),
  });
  const result = extractKeywordShoplingApplyArtifact(zip);
  assert.equal(result.summary.request_id, "keyword-apply-1");
  assert.equal(result.applyResults[0].goods_key, "1");
  assert.equal(result.verifyResults[0].site_srch_update_status, "ok");
  assert.deepEqual(result.blockedItems[0].reasons, ["NO"]);
  assert.equal(result.summary.request_xml, undefined);
  assert.equal(result.applyResults[0].request_xml, undefined);
  assert.equal(result.applyResults[0].API_KEY, undefined);
});

test("keyword review queue UI contains apply runner source strings", async () => {
  const source = await readFile(new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url), "utf8");
  for (const text of ["샵플링 반영 실행", "dry_run", "APPLY_KEYWORD_RESULTS_TO_SHOPLING", "샵플링 반영 dry_run 실행", "dry_run 결과 가져오기", "실제 샵플링 반영 실행", "반영 결과 가져오기", "상품별 첫 후보만 승인", "keywordReviewQueue.keywordApplyDryRunRequestId", "keywordReviewQueue.keywordApplyRequestId", "/api/keyword-shopling-apply/run", "/api/keyword-shopling-apply/actions-result"]) {
    assert.match(source, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("security source scan", async () => {
  const files = await Promise.all([
    readFile(new URL("../src/lib/keywordShoplingApplyRunner.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/keyword-shopling-apply/run/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/keyword-shopling-apply/actions-result/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url), "utf8"),
  ]);
  const source = files.join("\n");
  assert.doesNotMatch(source, /child_process|shell\s*:\s*true|PowerShell|SHOPLING_(API_KEY|SECRET|PASSWORD)|https?:\/\/[^\s'\"]*shopling/i);
});
