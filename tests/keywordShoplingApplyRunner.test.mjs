import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { zipSync, strToU8 } from "fflate";
import {
  buildKeywordShoplingApplyDispatchRequest,
  dispatchKeywordShoplingApplyActions,
  extractKeywordShoplingApplyArtifact,
  fetchKeywordShoplingApplyActionsResult,
} from "../src/lib/keywordShoplingApplyRunner.ts";

function withEnv(fn) {
  const old = { ...process.env };
  process.env.KEYWORD_SHOPLING_APPLY_ENABLED = "1";
  process.env.KEYWORD_SHOPLING_APPLY_REPO =
    "andysong111/andysong111-keyword-engine-soon";
  process.env.KEYWORD_SHOPLING_APPLY_WORKFLOW = "keyword-shopling-apply.yml";
  process.env.KEYWORD_SHOPLING_APPLY_REF = "main";
  process.env.KEYWORD_SHOPLING_APPLY_ACTIONS_TOKEN = "ghp_test_token";
  try {
    return fn();
  } finally {
    process.env = old;
  }
}
const plan = JSON.stringify([
  {
    goods_key: "1",
    mall_key: "SMALL_00004",
    final_title: "t",
    final_site_srch: "k",
  },
]);

test("dry_run dispatch request includes dry_run and safe preview", () =>
  withEnv(() => {
    const req = buildKeywordShoplingApplyDispatchRequest({
      execution_plan_json: plan,
      mode: "dry_run",
      confirmation_text: "",
      max_items: 20,
    });
    assert.equal(req.body.inputs.mode, "dry_run");
    assert.equal(req.body.inputs.execution_plan_json, plan);
    assert.match(req.commandPreview, /mode=dry_run/);
    assert.match(req.commandPreview, /item_count=1/);
    assert.doesNotMatch(
      req.commandPreview,
      /eligibleItems|execution_plan_json/,
    );
    assert.equal(
      "token" in JSON.parse(JSON.stringify({ ...req, token: undefined })),
      false,
    );
  }));

test("command preview counts direct list execution plans", () =>
  withEnv(() => {
    const directPlan = JSON.stringify([
      {
        goods_key: "1",
        mall_key: "SMALL_00004",
        final_title: "t1",
        final_site_srch: "k1",
      },
      {
        goods_key: "2",
        mall_key: "SMALL_00005",
        final_title: "t2",
        final_site_srch: "k2",
      },
      {
        goods_key: "3",
        mall_key: "SMALL_00006",
        final_title: "t3",
        final_site_srch: "k3",
      },
    ]);
    const req = buildKeywordShoplingApplyDispatchRequest({
      execution_plan_json: directPlan,
      mode: "dry_run",
      confirmation_text: "",
      max_items: 20,
    });
    assert.match(req.commandPreview, /item_count=3/);
    assert.doesNotMatch(req.commandPreview, /execution_plan_json|goods_key/);
  }));

test("dispatch failure returns safe GitHub body preview", async () => {
  await withEnv(async () => {
    const oldFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          message: "Validation Failed",
          execution_plan_json: [{ goods_key: "leak" }],
          token: "ghp_test_token",
        }),
        { status: 422 },
      );
    try {
      const result = await dispatchKeywordShoplingApplyActions({
        execution_plan_json: JSON.stringify([
          {
            goods_key: "1",
            mall_key: "SMALL_00004",
            final_title: "t",
            final_site_srch: "k",
          },
        ]),
        mode: "dry_run",
        confirmation_text: "",
        max_items: 20,
      });
      assert.equal(result.status, "error");
      assert.match(result.message, /status=422/);
      assert.match(result.message, /body=/);
      assert.doesNotMatch(result.message, /ghp_test_token/);
      assert.doesNotMatch(result.message, /execution_plan_json/);
    } finally {
      globalThis.fetch = oldFetch;
    }
  });
});

test("apply dispatch trims confirmation and still requires exact confirmation", () =>
  withEnv(() => {
    assert.throws(
      () =>
        buildKeywordShoplingApplyDispatchRequest({
          execution_plan_json: plan,
          mode: "apply",
          confirmation_text: "wrong",
          max_items: 20,
        }),
      /확인문구/,
    );
    const req = buildKeywordShoplingApplyDispatchRequest({
      execution_plan_json: plan,
      mode: "apply",
      confirmation_text: "  APPLY_KEYWORD_RESULTS_TO_SHOPLING  ",
      max_items: 20,
    });
    assert.equal(req.body.inputs.mode, "apply");
    assert.equal(
      req.body.inputs.confirmation_text,
      "APPLY_KEYWORD_RESULTS_TO_SHOPLING",
    );
  }));

test("artifact parsing extracts nested JSON/JSONL and omits raw XML/secrets", () => {
  const zip = zipSync({
    "output/shopling_apply/result_summary.json": strToU8(
      JSON.stringify({
        request_id: "keyword-apply-1",
        mode: "dry_run",
        status: "ok",
        input_item_count: 1,
        request_xml: "<secret/>",
        credentials: "x",
        env: { A: 1 },
      }),
    ),
    "output/shopling_apply/apply_results.jsonl": strToU8(
      JSON.stringify({
        goods_key: "1",
        mall_key: "m",
        title_update_status: "ok",
        request_xml: "<x/>",
        API_KEY: "secret",
      }) + "\n",
    ),
    "output/shopling_apply/verify_results.jsonl": strToU8(
      JSON.stringify({
        goods_key: "1",
        mall_key: "m",
        site_srch_update_status: "ok",
      }) + "\n",
    ),
    "output/shopling_apply/blocked_items.jsonl": strToU8(
      JSON.stringify({ goods_key: "2", mall_key: "m", reasons: ["NO"] }) + "\n",
    ),
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

test("artifact parsing keeps title/search apply status fields", () => {
  const zip = zipSync({
    "output/shopling_apply/result_summary.json": strToU8(
      JSON.stringify({
        request_id: "keyword-apply-1",
        mode: "apply",
        status: "success_with_verification_warning",
        title_apply_success_count: 1,
        title_apply_unverified_count: 1,
        title_apply_not_applied_count: 1,
        search_apply_success_count: 1,
        search_apply_not_applied_count: 0,
        requires_final_price_pass: true,
        failed_item_count: 0,
        applied_item_count: 1,
        errors: [],
        warnings: ["verify"],
      }),
    ),
    "output/shopling_apply/apply_results.jsonl": strToU8(
      JSON.stringify({
        goods_key: "1",
        mall_key: "SMALL_00004",
        requested_mall_title: "title",
        requested_site_srch: "kw",
        title_update_status: "api_success_unverified",
        mall_title_apply_status: "not_applied",
        site_srch_update_status: "verified",
        verification_status: "unverified",
        shopling_link_lookup_status: "found",
        mall_goods_cd_present: true,
        link_seq_present: true,
        title_payload_field_used: "goods_nm",
        code: "200",
        msg: "ok",
        message: "title not applied",
      }) + "\n",
    ),
  });
  const result = extractKeywordShoplingApplyArtifact(zip);
  assert.equal(result.summary.title_apply_success_count, 1);
  assert.equal(result.summary.requires_final_price_pass, true);
  assert.equal(result.applyResults[0].requested_mall_title, "title");
  assert.equal(result.applyResults[0].mall_title_apply_status, "not_applied");
  assert.equal(result.applyResults[0].verification_status, "unverified");
  assert.equal(result.applyResults[0].message, "title not applied");
});

test("keyword review queue UI contains apply runner source strings and guards", async () => {
  const source = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  for (const text of [
    "샵플링 반영 실행",
    "dry_run",
    "APPLY_KEYWORD_RESULTS_TO_SHOPLING",
    "확인문구가 내부에서 자동으로 전달됩니다",
    "확인문구가 자동으로 포함됩니다",
    "샵플링 반영 dry_run 실행",
    "결과 가져오기",
    "실제 샵플링 반영 실행",
    "상품별 첫 후보만 승인",
    "keywordReviewQueue.keywordApplyDryRunRequestId",
    "keywordReviewQueue.keywordApplyRequestId",
    "keywordApplyDryRunResult",
    "keywordApplyRealResult",
    "keywordApplyDryRunStatus",
    "keywordApplyRealStatus",
    "아직 실제 반영 실행 요청 ID가 없습니다",
    "아직 dry_run 실행 요청 ID가 없습니다",
    "가져온 결과가 실제 반영 결과가 아니라 dry_run 결과입니다",
    'confirmation_text: mode === "apply" ? KEYWORD_APPLY_CONFIRMATION_TEXT : ""',
    "/api/keyword-shopling-apply/run",
    "/api/keyword-shopling-apply/actions-result",
    "mode=${encodeURIComponent(mode)}",
    "buildCompactKeywordApplyExecutionPlan",
    "GitHub Actions 입력값 검증에서 거절되었습니다",
  ]) {
    assert.match(
      source,
      new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  assert.doesNotMatch(
    source,
    /executionPlanJson = preflightResult[\s\S]*blockedItems: preflightResult\.blockedItems/,
  );
  assert.doesNotMatch(
    source,
    /placeholder="APPLY_KEYWORD_RESULTS_TO_SHOPLING"/,
  );
  assert.doesNotMatch(
    source,
    /onConfirmationTextChange|keywordApplyConfirmationText|확인문구 자동 입력|최종 확인문구/,
  );
});

test("actions result API and runner support mode filtering", async () => {
  const route = await readFile(
    new URL(
      "../src/app/api/keyword-shopling-apply/actions-result/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const runner = await readFile(
    new URL("../src/lib/keywordShoplingApplyRunner.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /params\.get\("mode"\)/);
  assert.match(
    route,
    /fetchKeywordShoplingApplyActionsResult\(requestId, mode/,
  );
  assert.match(runner, /summaryMode !== mode/);
  assert.match(
    runner,
    /가져온 결과가 실제 반영 결과가 아니라 dry_run 결과입니다/,
  );
});

test("fetch result rejects mismatched mode instead of returning stale dry_run as apply", async () => {
  await withEnv(async () => {
    const zip = zipSync({
      "output/shopling_apply/result_summary.json": strToU8(
        JSON.stringify({
          request_id: "keyword-apply-match",
          mode: "dry_run",
          status: "success",
        }),
      ),
    });
    const oldFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const text = String(url);
      if (text.includes("/runs?"))
        return new Response(
          JSON.stringify({
            workflow_runs: [
              {
                id: 1,
                status: "completed",
                conclusion: "success",
                html_url: "https://github.com/x/y/actions/runs/1",
              },
            ],
          }),
        );
      if (text.includes("/artifacts"))
        return new Response(
          JSON.stringify({
            artifacts: [
              {
                name: "keyword-shopling-apply-result",
                archive_download_url: "https://artifact.local/zip",
              },
            ],
          }),
        );
      return new Response(zip);
    };
    try {
      const result = await fetchKeywordShoplingApplyActionsResult(
        "keyword-apply-match",
        "apply",
      );
      assert.equal(result.status, "pending");
      assert.match(result.message, /dry_run 결과입니다/);
      assert.equal(result.summary, undefined);
    } finally {
      globalThis.fetch = oldFetch;
    }
  });
});

test("apply runner rejects previewItems-shaped or fake mall_key plans", async () => {
  const { validateKeywordShoplingApplyInput } =
    await import("../src/lib/keywordShoplingApplyRunner.ts");
  assert.throws(
    () =>
      validateKeywordShoplingApplyInput({
        execution_plan_json: JSON.stringify([
          {
            goods_key: "1",
            mall_key: "SMALL_00004",
            final_title: "t",
            final_site_srch: "k",
            preview_payload: {},
          },
        ]),
        mode: "dry_run",
        max_items: 10,
      }),
    /buildCompactKeywordApplyExecutionPlan/,
  );
  assert.throws(
    () =>
      validateKeywordShoplingApplyInput({
        execution_plan_json: JSON.stringify([
          {
            goods_key: "1",
            mall_key: "mall-1",
            final_title: "t",
            final_site_srch: "k",
          },
        ]),
        mode: "dry_run",
        max_items: 10,
      }),
    /SMALL_000xx/,
  );
});

test("product launch manual apply polling UI source scan", async () => {
  const source = await readFile(
    new URL(
      "../src/components/product-launch-flow/ProductLaunchFlow.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  for (const text of [
    "manualApplyRequestId",
    "manualApplyActionsUrl",
    "manualApplyRunUrl",
    "manualApplyCommandPreview",
    "manualApplyResult",
    "manualApplyPolling",
    "manualApplyPollCount",
    "manualApplyLastCheckedAt",
    "manualApplyNextCheckIn",
    "manualApplyErrorMessage",
    "실제 반영 요청 전송 완료",
    "GitHub Actions에서 쇼핑몰별 상품명/검색어 반영을 실행 중입니다.",
    "/api/keyword-shopling-apply/actions-result?request_id=",
    "&mode=apply",
    "실제 반영 진행상태",
    "쇼핑몰별 상품명 반영",
    "검색어 반영",
    "title_update_status / mall_title_apply_status / message",
    "실제 반영 결과 확인 후 가격 최종 재적용을 진행하세요.",
  ]) {
    assert.match(
      source,
      new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  assert.doesNotMatch(
    source,
    /realApplyStatus: json\.status === "error" \? "failed" : "success"/,
  );
  assert.doesNotMatch(
    source,
    /runFinalPriceModify\(\)[\s\S]{0,200}json\.requestId/,
  );
});

test("security source scan", async () => {
  const files = await Promise.all([
    readFile(
      new URL("../src/lib/keywordShoplingApplyRunner.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/app/api/keyword-shopling-apply/run/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/app/api/keyword-shopling-apply/actions-result/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/components/product-launch-flow/ProductLaunchFlow.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  const source = files.join("\n");
  assert.doesNotMatch(
    source,
    /child_process|shell\s*:\s*true|PowerShell|SHOPLING_(API_KEY|SECRET|PASSWORD)|https?:\/\/[^\s'\"]*shopling/i,
  );
});
