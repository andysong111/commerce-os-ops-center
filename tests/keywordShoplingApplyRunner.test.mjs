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


test("command preview counts direct list execution plans", () => withEnv(() => {
  const directPlan = JSON.stringify([{ goods_key: "1" }, { goods_key: "2" }, { goods_key: "3" }]);
  const req = buildKeywordShoplingApplyDispatchRequest({ execution_plan_json: directPlan, mode: "dry_run", confirmation_text: "", max_items: 20 });
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
      const result = await dispatchKeywordShoplingApplyActions({ execution_plan_json: JSON.stringify([{ goods_key: "1" }]), mode: "dry_run", confirmation_text: "", max_items: 20 });
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

test("apply dispatch trims confirmation and still requires exact confirmation", () => withEnv(() => {
  assert.throws(() => buildKeywordShoplingApplyDispatchRequest({ execution_plan_json: plan, mode: "apply", confirmation_text: "wrong", max_items: 20 }), /확인문구/);
  const req = buildKeywordShoplingApplyDispatchRequest({ execution_plan_json: plan, mode: "apply", confirmation_text: "  APPLY_KEYWORD_RESULTS_TO_SHOPLING  ", max_items: 20 });
  assert.equal(req.body.inputs.mode, "apply");
  assert.equal(req.body.inputs.confirmation_text, "APPLY_KEYWORD_RESULTS_TO_SHOPLING");
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

test("keyword review queue UI contains apply runner source strings and guards", async () => {
  const source = await readFile(new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url), "utf8");
  for (const text of ["샵플링 반영 실행", "dry_run", "APPLY_KEYWORD_RESULTS_TO_SHOPLING", "확인문구가 내부에서 자동으로 전달됩니다", "확인문구가 자동으로 포함됩니다", "샵플링 반영 dry_run 실행", "dry_run 결과 가져오기", "실제 샵플링 반영 실행", "반영 결과 가져오기", "상품별 첫 후보만 승인", "keywordReviewQueue.keywordApplyDryRunRequestId", "keywordReviewQueue.keywordApplyRequestId", "keywordApplyDryRunResult", "keywordApplyRealResult", "keywordApplyDryRunStatus", "keywordApplyRealStatus", "아직 실제 반영 실행 요청 ID가 없습니다", "아직 dry_run 실행 요청 ID가 없습니다", "가져온 결과가 실제 반영 결과가 아니라 dry_run 결과입니다", "confirmation_text: mode === \"apply\" ? KEYWORD_APPLY_CONFIRMATION_TEXT : \"\"", "/api/keyword-shopling-apply/run", "/api/keyword-shopling-apply/actions-result", "mode=${encodeURIComponent(mode)}", "buildCompactKeywordApplyExecutionPlan", "GitHub Actions 입력값 검증에서 거절되었습니다"]) {
    assert.match(source, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(source, /executionPlanJson = preflightResult[\s\S]*blockedItems: preflightResult\.blockedItems/);
  assert.doesNotMatch(source, /placeholder="APPLY_KEYWORD_RESULTS_TO_SHOPLING"/);
  assert.doesNotMatch(source, /onConfirmationTextChange|keywordApplyConfirmationText|확인문구 자동 입력|최종 확인문구/);
});

test("actions result API and runner support mode filtering", async () => {
  const route = await readFile(new URL("../src/app/api/keyword-shopling-apply/actions-result/route.ts", import.meta.url), "utf8");
  const runner = await readFile(new URL("../src/lib/keywordShoplingApplyRunner.ts", import.meta.url), "utf8");
  assert.match(route, /params\.get\("mode"\)/);
  assert.match(route, /fetchKeywordShoplingApplyActionsResult\(requestId, mode/);
  assert.match(runner, /summaryMode !== mode/);
  assert.match(runner, /가져온 결과가 실제 반영 결과가 아니라 dry_run 결과입니다/);
});

test("fetch result rejects mismatched mode instead of returning stale dry_run as apply", async () => {
  await withEnv(async () => {
    const zip = zipSync({
      "output/shopling_apply/result_summary.json": strToU8(JSON.stringify({ request_id: "keyword-apply-match", mode: "dry_run", status: "success" })),
    });
    const oldFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const text = String(url);
      if (text.includes("/runs?")) return new Response(JSON.stringify({ workflow_runs: [{ id: 1, status: "completed", conclusion: "success", display_title: "Keyword Shopling Apply - dry_run - keyword-apply-match", html_url: "https://github.com/x/y/actions/runs/1" }] }));
      if (text.includes("/artifacts")) return new Response(JSON.stringify({ artifacts: [{ name: "keyword-shopling-apply-result", archive_download_url: "https://artifact.local/zip" }] }));
      return new Response(zip);
    };
    try {
      const result = await fetchKeywordShoplingApplyActionsResult("keyword-apply-match", "apply");
      assert.equal(result.status, "pending");
      assert.match(result.message, /dry_run 결과입니다/);
      assert.equal(result.summary, undefined);
    } finally {
      globalThis.fetch = oldFetch;
    }
  });
});


test("request_id strict matching ignores old unrelated completed run", async () => {
  await withEnv(async () => {
    const oldFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const text = String(url);
      if (text.includes("/runs?")) return new Response(JSON.stringify({ workflow_runs: [{ id: 3, name: "Keyword Shopling Apply", display_title: "Keyword Shopling Apply #3", status: "completed", conclusion: "failure", html_url: "https://github.com/x/y/actions/runs/3" }] }));
      throw new Error(`unexpected fetch ${text}`);
    };
    try {
      const result = await fetchKeywordShoplingApplyActionsResult("keyword-apply-new", "dry_run");
      assert.equal(result.status, "pending");
      assert.equal(result.phase, "queued");
      assert.equal(result.runId, undefined);
      assert.match(result.message, /아직 이 요청 ID와 매칭되는 GitHub Actions 실행을 찾지 못했습니다/);
      assert.equal(result.runUrl, "https://github.com/andysong111/andysong111-keyword-engine-soon/actions/workflows/keyword-shopling-apply.yml");
    } finally {
      globalThis.fetch = oldFetch;
    }
  });
});

test("request_id matches display_title and returns matched run while artifact is pending", async () => {
  await withEnv(async () => {
    const oldFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const text = String(url);
      if (text.includes("/runs?")) return new Response(JSON.stringify({ workflow_runs: [{ id: 9, display_title: "Keyword Shopling Apply - dry_run - keyword-apply-title", status: "in_progress", conclusion: null, html_url: "https://github.com/x/y/actions/runs/9" }] }));
      if (text.includes("/artifacts")) return new Response(JSON.stringify({ artifacts: [] }));
      throw new Error(`unexpected fetch ${text}`);
    };
    try {
      const result = await fetchKeywordShoplingApplyActionsResult("keyword-apply-title", "dry_run");
      assert.equal(result.status, "pending");
      assert.equal(result.phase, "running");
      assert.equal(result.runId, 9);
      assert.equal(result.runUrl, "https://github.com/x/y/actions/runs/9");
    } finally {
      globalThis.fetch = oldFetch;
    }
  });
});

test("request_id matches artifact summary and returns success", async () => {
  await withEnv(async () => {
    const zip = zipSync({ "output/shopling_apply/result_summary.json": strToU8(JSON.stringify({ request_id: "keyword-apply-artifact", mode: "dry_run", status: "success" })) });
    const oldFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const text = String(url);
      if (text.includes("/runs?")) return new Response(JSON.stringify({ workflow_runs: [{ id: 7, display_title: "Keyword Shopling Apply - dry_run - keyword-apply-artifact", status: "completed", conclusion: "success", html_url: "https://github.com/x/y/actions/runs/7" }] }));
      if (text.includes("/artifacts")) return new Response(JSON.stringify({ artifacts: [{ name: "keyword-shopling-apply-result", archive_download_url: "https://artifact.local/zip" }] }));
      return new Response(zip);
    };
    try {
      const result = await fetchKeywordShoplingApplyActionsResult("keyword-apply-artifact", "dry_run");
      assert.equal(result.status, "success");
      assert.equal(result.summary.request_id, "keyword-apply-artifact");
    } finally { globalThis.fetch = oldFetch; }
  });
});

test("artifact summary request_id mismatch is skipped", async () => {
  await withEnv(async () => {
    const zip = zipSync({ "output/shopling_apply/result_summary.json": strToU8(JSON.stringify({ request_id: "keyword-apply-other", mode: "dry_run", status: "success" })) });
    const oldFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const text = String(url);
      if (text.includes("/runs?")) return new Response(JSON.stringify({ workflow_runs: [{ id: 8, display_title: "Keyword Shopling Apply - dry_run - keyword-apply-wanted", status: "completed", conclusion: "success", html_url: "https://github.com/x/y/actions/runs/8" }] }));
      if (text.includes("/artifacts")) return new Response(JSON.stringify({ artifacts: [{ name: "keyword-shopling-apply-result", archive_download_url: "https://artifact.local/zip" }] }));
      return new Response(zip);
    };
    try {
      const result = await fetchKeywordShoplingApplyActionsResult("keyword-apply-wanted", "dry_run");
      assert.equal(result.status, "pending");
      assert.equal(result.summary, undefined);
    } finally { globalThis.fetch = oldFetch; }
  });
});

test("without request_id latest artifact-backed run can still be returned", async () => {
  await withEnv(async () => {
    const zip = zipSync({ "output/shopling_apply/result_summary.json": strToU8(JSON.stringify({ request_id: "keyword-apply-latest", mode: "dry_run", status: "success" })) });
    const oldFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const text = String(url);
      if (text.includes("/runs?")) return new Response(JSON.stringify({ workflow_runs: [{ id: 11, status: "completed", conclusion: "success", html_url: "https://github.com/x/y/actions/runs/11" }] }));
      if (text.includes("/artifacts")) return new Response(JSON.stringify({ artifacts: [{ name: "keyword-shopling-apply-result", archive_download_url: "https://artifact.local/zip" }] }));
      return new Response(zip);
    };
    try {
      const result = await fetchKeywordShoplingApplyActionsResult(undefined, "dry_run");
      assert.equal(result.status, "success");
      assert.equal(result.requestId, "keyword-apply-latest");
    } finally { globalThis.fetch = oldFetch; }
  });
});

test("UI and runner contain strict matching labels and no stale latest wording", async () => {
  const source = (await Promise.all([
    readFile(new URL("../src/lib/keywordShoplingApplyRunner.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/OperationStatusCard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url), "utf8"),
  ])).join("\n");
  for (const text of ["아직 이 요청 ID와 매칭되는 GitHub Actions 실행을 찾지 못했습니다", "GitHub Actions 워크플로 열기", "GitHub Actions 실행 열기", "아직 실행 페이지가 연결되지 않았습니다", "워크플로 목록 열기", "실행 로그 열기"]) {
    assert.match(source, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(source, /최신 실행을 확인하세요/);
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
