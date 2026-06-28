import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import {
  buildShoplingProductUploadCommand,
  buildShoplingProductUploadDispatchRequest,
  buildShoplingProductUploadActionsRunsUrl,
  dispatchShoplingProductUploadActions,
  extractShoplingUploadResultSummary,
  fetchShoplingProductUploadActionsResult,
  buildShoplingProductUploadSpawnOptions,
  estimateTargetCount,
  generateShoplingProductUploadRequestId,
  isValidShoplingRequestId,
  isValidRowExpression,
  isValidShoplingProductUploadChannel,
} from "../src/lib/shoplingProductUploadRunner.ts";

const acceptedRows = ["967", "698,714", "714-730", "698,714-730,801"];
const rejectedRows = [
  "",
  "abc",
  "1; rm -rf",
  "1 && echo test",
  "../run_batch.py",
  "1|whoami",
  "1 2",
  "1/2",
  "1\\2",
  '"1"',
  "'1'",
];

test("row expression validation accepts supported formats", () => {
  for (const rowExpression of acceptedRows) {
    assert.equal(isValidRowExpression(rowExpression), true, rowExpression);
  }
});

test("row expression validation rejects unsafe or unsupported formats", () => {
  for (const rowExpression of rejectedRows) {
    assert.equal(isValidRowExpression(rowExpression), false, rowExpression);
  }
});

test("channel validation accepts only the allowlist and empty 전체 value", () => {
  for (const channel of ["", "도매1", "도매2", "도매3", "도매4", "소매1", "소매2"]) {
    assert.equal(isValidShoplingProductUploadChannel(channel), true, channel);
  }
  for (const channel of ["전체", "도매5", "소매3", "admin", "1;whoami"]) {
    assert.equal(isValidShoplingProductUploadChannel(channel), false, channel);
  }
});

test("command builder creates a safe argument array for all-channel runs and ignores dump by default", () => {
  delete process.env.SHOPLING_PRODUCT_UPLOAD_RAW_DUMP_ENABLED;

  const command = buildShoplingProductUploadCommand({
    rowExpression: "967",
    channel: "",
    skip_if_goods_key: true,
    dump: true,
    sleep: 1.2,
  });

  assert.deepEqual(command.args, [
    "run_batch.py",
    "967",
    "--skip_if_goods_key",
    "--sleep",
    "1.2",
  ]);
  assert.equal(command.shell, false);
  assert.equal(command.args.includes("--channel"), false);
  assert.equal(command.commandPreview, 'python run_batch.py "967" --skip_if_goods_key --sleep 1.2');
  assert.equal(command.args.includes("--dump"), false);
  assert.equal(command.commandPreview.includes("--dump"), false);
  assert.equal(command.args.includes("--skip_if_goods_key"), true);
  assert.equal(command.rawDumpEnabled, false);
  assert.equal(command.rawDumpReason, "민감정보 보호를 위해 원문 XML 덤프는 비활성화되어 있습니다.");
});

test("command builder allows dump only when explicit raw dump env flag is enabled", () => {
  process.env.SHOPLING_PRODUCT_UPLOAD_RAW_DUMP_ENABLED = "1";
  try {
    const command = buildShoplingProductUploadCommand({
      rowExpression: "967",
      channel: "",
      skip_if_goods_key: true,
      dump: true,
      sleep: 1.2,
    });

    assert.equal(command.args.includes("--dump"), true);
    assert.equal(command.commandPreview.includes("--dump"), true);
    assert.equal(command.rawDumpEnabled, true);
    assert.equal(command.rawDumpReason, undefined);
  } finally {
    delete process.env.SHOPLING_PRODUCT_UPLOAD_RAW_DUMP_ENABLED;
  }
});

test("command builder includes channel only when selected", () => {
  const command = buildShoplingProductUploadCommand({
    rowExpression: "698,714-730,801",
    channel: "도매1",
    skip_if_goods_key: true,
    dump: false,
    sleep: "1.2",
  });

  assert.deepEqual(command.args, [
    "run_batch.py",
    "698,714-730,801",
    "--channel",
    "도매1",
    "--skip_if_goods_key",
    "--sleep",
    "1.2",
  ]);
  assert.equal(command.shell, false);
  assert.equal(command.commandPreview.includes("--channel \"도매1\""), true);
  assert.equal(command.args.includes("--dump"), false);
  assert.equal(command.args.includes("--skip_if_goods_key"), true);
});

test("spawn options force Python UTF-8 output without enabling shell", () => {
  const options = buildShoplingProductUploadSpawnOptions("/tmp/shopling-engine");

  assert.equal(options.cwd, "/tmp/shopling-engine");
  assert.equal(options.shell, false);
  assert.equal(options.env.PYTHONIOENCODING, "utf-8");
  assert.equal(options.env.PYTHONUTF8, "1");
  assert.equal(options.env.PATH, process.env.PATH);
});

test("target count protection allows small ranges and rejects over 300", () => {
  assert.equal(estimateTargetCount("967", ""), 6);
  assert.equal(estimateTargetCount("714-730", "도매1"), 17);
  assert.throws(
    () => buildShoplingProductUploadCommand({ rowExpression: "1-51", channel: "", sleep: 1.2 }),
    /최대 300건/,
  );
});

function withGithubActionsEnv(overrides, callback) {
  const keys = [
    "SHOPLING_UPLOAD_REPO",
    "SHOPLING_UPLOAD_WORKFLOW",
    "SHOPLING_UPLOAD_REF",
    "GITHUB_ACTIONS_TOKEN",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.SHOPLING_UPLOAD_REPO = "andysong111/shopling-product-upload-auto";
  process.env.SHOPLING_UPLOAD_WORKFLOW = "shopling-product-upload.yml";
  process.env.SHOPLING_UPLOAD_REF = "main";
  process.env.GITHUB_ACTIONS_TOKEN = "ghp_test_secret";
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("request ID generation creates safe shopling-prefixed values", () => {
  const requestId = generateShoplingProductUploadRequestId(new Date("2026-06-23T03:25:00.000Z"));
  assert.match(requestId, /^[A-Za-z0-9._:-]{1,120}$/);
  assert.equal(requestId.startsWith("shopling-20260623T032500Z-"), true);
  assert.equal(isValidShoplingRequestId(requestId), true);
  assert.equal(isValidShoplingRequestId("shopling bad/slash"), false);
});

test("GitHub Actions dispatch payload maps empty channel to all-channel workflow input", () => {
  withGithubActionsEnv({}, () => {
    const request = buildShoplingProductUploadDispatchRequest({
      rowExpression: "950",
      channel: "",
      skip_if_goods_key: true,
    });

    assert.equal(request.url, "https://api.github.com/repos/andysong111/shopling-product-upload-auto/actions/workflows/shopling-product-upload.yml/dispatches");
    assert.equal(request.githubActionsUrl, "https://github.com/andysong111/shopling-product-upload-auto/actions/workflows/shopling-product-upload.yml");
    assert.equal(request.body.ref, "main");
    assert.equal(request.body.inputs.row_expression, "950");
    assert.equal(request.body.inputs.channel, "전체 6채널");
    assert.equal(request.body.inputs.skip_if_goods_key, true);
    assert.match(request.body.inputs.request_id, /^[A-Za-z0-9._:-]{1,120}$/);
    assert.equal(request.body.inputs.request_id.startsWith("shopling-"), true);
    assert.equal(request.requestId, request.body.inputs.request_id);
    assert.equal(request.commandPreview, `GitHub Actions: shopling-product-upload.yml row=950 channel=전체 6채널 skip_if_goods_key=true request_id=${request.requestId}`);
    assert.equal(request.token, "ghp_test_secret");
  });
});

test("GitHub Actions dispatch payload preserves selected channel and ref", () => {
  withGithubActionsEnv({ SHOPLING_UPLOAD_REF: "main" }, () => {
    const request = buildShoplingProductUploadDispatchRequest({
      rowExpression: "698,714-730,801",
      channel: "도매1",
      skip_if_goods_key: false,
    });

    assert.equal(request.body.ref, "main");
    assert.equal(request.body.inputs.row_expression, "698,714-730,801");
    assert.equal(request.body.inputs.channel, "도매1");
    assert.equal(request.body.inputs.skip_if_goods_key, false);
    assert.equal(request.body.inputs.request_id, request.requestId);
  });
});

test("GitHub Actions env validation rejects missing or invalid repository settings safely", () => {
  withGithubActionsEnv({ GITHUB_ACTIONS_TOKEN: undefined }, () => {
    assert.throws(
      () => buildShoplingProductUploadDispatchRequest({ rowExpression: "950", channel: "", skip_if_goods_key: true }),
      /GITHUB_ACTIONS_TOKEN/,
    );
  });
  withGithubActionsEnv({ SHOPLING_UPLOAD_REPO: undefined }, () => {
    assert.throws(
      () => buildShoplingProductUploadDispatchRequest({ rowExpression: "950", channel: "", skip_if_goods_key: true }),
      /SHOPLING_UPLOAD_REPO/,
    );
  });
  withGithubActionsEnv({ SHOPLING_UPLOAD_REPO: "invalid" }, () => {
    assert.throws(
      () => buildShoplingProductUploadDispatchRequest({ rowExpression: "950", channel: "", skip_if_goods_key: true }),
      /owner\/repo/,
    );
  });
});

test("GitHub Actions result helper builds workflow runs URL correctly", () => {
  withGithubActionsEnv({}, () => {
    const request = buildShoplingProductUploadActionsRunsUrl();
    assert.equal(request.url, "https://api.github.com/repos/andysong111/shopling-product-upload-auto/actions/workflows/shopling-product-upload.yml/runs?branch=main&event=workflow_dispatch&per_page=10");
    assert.equal(request.token, "ghp_test_secret");
    const correlatedRequest = buildShoplingProductUploadActionsRunsUrl(20);
    assert.equal(correlatedRequest.url.endsWith("per_page=20"), true);
  });
});

test("GitHub Actions result helper requires token and rejects invalid repo", () => {
  withGithubActionsEnv({ GITHUB_ACTIONS_TOKEN: undefined }, () => {
    assert.throws(() => buildShoplingProductUploadActionsRunsUrl(), /GITHUB_ACTIONS_TOKEN/);
  });
  withGithubActionsEnv({ SHOPLING_UPLOAD_REPO: "invalid/repo/extra" }, () => {
    assert.throws(() => buildShoplingProductUploadActionsRunsUrl(), /owner\/repo/);
  });
});

function zipSummary(path, summary) {
  return zipSync({ [path]: strToU8(JSON.stringify(summary)) });
}

test("GitHub Actions result helper extracts result_summary.json from exact artifact path", () => {
  const summary = {
    schema_version: 1,
    source: "shopling-product-upload-auto",
    status: "success",
    ok_count: 1,
    skip_count: 2,
    fail_count: 0,
  };

  assert.deepEqual(
    extractShoplingUploadResultSummary(zipSummary("output/github_actions/result_summary.json", summary)),
    summary,
  );
});

test("GitHub Actions result helper extracts result_summary.json from artifact root", () => {
  const summary = { status: "success", request_id: "shopling-root" };

  assert.deepEqual(
    extractShoplingUploadResultSummary(zipSummary("result_summary.json", summary)),
    summary,
  );
});

test("GitHub Actions result helper extracts nested result_summary.json artifact entry", () => {
  const summary = { status: "success", request_id: "shopling-nested" };

  assert.deepEqual(
    extractShoplingUploadResultSummary(zipSummary("some/path/result_summary.json", summary)),
    summary,
  );
});

test("GitHub Actions result helper missing summary error includes safe artifact entry names", () => {
  const zip = zipSync({
    "logs/run.log": strToU8("log body should not be exposed"),
    "queue/request.json": strToU8("{\"token\":\"secret\"}"),
  });

  assert.throws(
    () => extractShoplingUploadResultSummary(zip),
    (error) => {
      assert.match(error.message, /result_summary\.json을 찾을 수 없습니다/);
      assert.match(error.message, /artifact entries: logs\/run\.log, queue\/request\.json/);
      assert.equal(error.message.includes("log body should not be exposed"), false);
      assert.equal(error.message.includes("secret"), false);
      return true;
    },
  );
});

test("GitHub Actions result helper prefers root summary path when multiple entries exist", () => {
  const exactSummary = { status: "success", request_id: "shopling-exact" };
  const rootSummary = { status: "success", request_id: "shopling-root" };
  const nestedSummary = { status: "success", request_id: "shopling-nested" };
  const zip = zipSync({
    "some/path/result_summary.json": strToU8(JSON.stringify(nestedSummary)),
    "result_summary.json": strToU8(JSON.stringify(rootSummary)),
    "output/github_actions/result_summary.json": strToU8(JSON.stringify(exactSummary)),
  });

  assert.deepEqual(extractShoplingUploadResultSummary(zip), rootSummary);
});

test("GitHub Actions result helper handles no completed runs as pending", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ workflow_runs: [{ id: 1, status: "in_progress" }] }), { status: 200 });
  const previousEnabled = process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED;
  process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED = "1";
  try {
    await withGithubActionsEnv({}, async () => {
      const result = await fetchShoplingProductUploadActionsResult();
      assert.equal(result.status, "pending");
      assert.match(result.message, /진행 중/);
      assert.equal(result.phase, "running");
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) delete process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED;
    else process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED = previousEnabled;
  }
});

test("GitHub Actions result helper reports active runs before final artifact polling", async () => {
  const previousFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes("/runs?")) {
      return new Response(JSON.stringify({ workflow_runs: [
        { id: 10, status: "in_progress", conclusion: null, html_url: "https://github.com/run/10" },
        { id: 9, status: "completed", conclusion: "failure", html_url: "https://github.com/run/9" },
        { id: 8, status: "completed", conclusion: "success", html_url: "https://github.com/run/8" },
      ] }), { status: 200 });
    }
    return new Response(JSON.stringify({ artifacts: [] }), { status: 200 });
  };
  const previousEnabled = process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED;
  process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED = "1";
  try {
    await withGithubActionsEnv({}, async () => {
      const result = await fetchShoplingProductUploadActionsResult();
      assert.equal(result.status, "pending");
      assert.equal(result.phase, "running");
      assert.equal(result.runId, 10);
      assert.match(result.message, /진행 중/);
      assert.equal(urls.some((url) => url.includes("/actions/runs/9/artifacts")), false);
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) delete process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED;
    else process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED = previousEnabled;
  }
});

test("GitHub Actions result helper downloads artifact summary without exposing secrets or binary", async () => {
  const previousFetch = globalThis.fetch;
  const summary = {
    schema_version: 1,
    source: "shopling-product-upload-auto",
    status: "success",
    exit_code: 0,
    ok_count: 0,
    skip_count: 6,
    fail_count: 0,
    goods_keys: [{ row: 950, channel: "도매1", code: "A", success: true, goods_key: "123", ptn_goods_cd: "P123" }],
  };
  const zip = zipSync({
    "output/github_actions/result_summary.json": strToU8(JSON.stringify(summary)),
    "service-account.json": strToU8("{\"private_key\":\"secret\"}"),
  });
  globalThis.fetch = async (url) => {
    if (String(url).includes("/runs?")) {
      return new Response(JSON.stringify({ workflow_runs: [{ id: 27999182522, status: "completed", conclusion: "success", html_url: "https://github.com/andysong111/shopling-product-upload-auto/actions/runs/27999182522" }] }), { status: 200 });
    }
    if (String(url).includes("/artifacts")) {
      return new Response(JSON.stringify({ artifacts: [{ name: "shopling-upload-logs-queue-abc", archive_download_url: "https://api.github.com/artifact.zip" }] }), { status: 200 });
    }
    return new Response(zip, { status: 200 });
  };
  const previousEnabled = process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED;
  process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED = "1";
  try {
    await withGithubActionsEnv({}, async () => {
      const result = await fetchShoplingProductUploadActionsResult();
      const serialized = JSON.stringify(result);
      assert.equal(result.status, "success");
      assert.deepEqual(result.summary, summary);
      assert.equal(serialized.includes("ghp_test_secret"), false);
      assert.equal(serialized.includes("private_key"), false);
      assert.equal(serialized.includes("PK"), false);
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) delete process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED;
    else process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED = previousEnabled;
  }
});

test("GitHub Actions dispatch success returns queued result without exposing token", async () => {
  const previousFetch = globalThis.fetch;
  let fetchCall;
  globalThis.fetch = async (url, init) => {
    fetchCall = { url, init };
    return { status: 204, text: async () => "" };
  };
  try {
    await withGithubActionsEnv({}, async () => {
      const result = await dispatchShoplingProductUploadActions({
        rowExpression: "950",
        channel: "",
        skip_if_goods_key: true,
      });

      assert.equal(result.status, "queued");
      assert.match(result.requestId, /^[A-Za-z0-9._:-]{1,120}$/);
      assert.equal(result.commandPreview.includes(`request_id=${result.requestId}`), true);
      assert.equal(result.githubActionsUrl, "https://github.com/andysong111/shopling-product-upload-auto/actions/workflows/shopling-product-upload.yml");
      assert.equal(JSON.stringify(result).includes("ghp_test_secret"), false);
      assert.equal(fetchCall.init.headers.Authorization, "Bearer ghp_test_secret");
      const body = JSON.parse(fetchCall.init.body);
      assert.equal(body.inputs.channel, "전체 6채널");
      assert.equal(body.inputs.request_id, result.requestId);
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});


test("GitHub Actions result helper matches requested request_id and skips non-matching summaries", async () => {
  const previousFetch = globalThis.fetch;
  const summaries = {
    11: { status: "success", request_id: "shopling-other" },
    10: { status: "success", request_id: "shopling-match" },
  };
  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/runs?")) {
      assert.equal(text.includes("per_page=20"), true);
      return new Response(JSON.stringify({ workflow_runs: [
        { id: 11, status: "completed", conclusion: "success", html_url: "https://github.com/run/11" },
        { id: 10, status: "completed", conclusion: "success", html_url: "https://github.com/run/10" },
      ] }), { status: 200 });
    }
    if (text.includes("/artifacts")) {
      return new Response(JSON.stringify({ artifacts: [{ name: "shopling-upload-logs-queue-abc", archive_download_url: `https://api.github.com/artifact-${text.includes("/11/") ? "11" : "10"}.zip` }] }), { status: 200 });
    }
    const id = text.includes("artifact-11") ? 11 : 10;
    return new Response(zipSync({ "output/github_actions/result_summary.json": strToU8(JSON.stringify(summaries[id])) }), { status: 200 });
  };
  const previousEnabled = process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED;
  process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED = "1";
  try {
    await withGithubActionsEnv({}, async () => {
      const result = await fetchShoplingProductUploadActionsResult("shopling-match");
      assert.equal(result.status, "success");
      assert.equal(result.runId, 10);
      assert.equal(result.summary.request_id, "shopling-match");
      assert.equal(result.requestId, "shopling-match");
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) delete process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED;
    else process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED = previousEnabled;
  }
});

test("GitHub Actions result helper returns pending when requested request_id has no completed summary", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/runs?")) return new Response(JSON.stringify({ workflow_runs: [{ id: 1, status: "completed", conclusion: "success" }] }), { status: 200 });
    if (String(url).includes("/artifacts")) return new Response(JSON.stringify({ artifacts: [{ name: "shopling-upload-logs-queue-abc", archive_download_url: "https://api.github.com/artifact.zip" }] }), { status: 200 });
    return new Response(zipSync({ "output/github_actions/result_summary.json": strToU8(JSON.stringify({ request_id: "shopling-other" })) }), { status: 200 });
  };
  const previousEnabled = process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED;
  process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED = "1";
  try {
    await withGithubActionsEnv({}, async () => {
      const result = await fetchShoplingProductUploadActionsResult("shopling-missing");
      assert.equal(result.status, "pending");
      assert.equal(result.requestId, "shopling-missing");
      assert.match(result.message, /현재 요청 ID와 일치하는 GitHub Actions 실행을 찾는 중입니다/);
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) delete process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED;
    else process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED = previousEnabled;
  }
});

test("actions-result route parses and validates request_id query param", async () => {
  const { GET } = await import("../src/app/api/shopling-product-upload/actions-result/route.ts");
  const invalid = await GET(new Request("http://localhost/api/shopling-product-upload/actions-result?request_id=bad/slash"));
  assert.equal(invalid.status, 400);
  const invalidJson = await invalid.json();
  assert.equal(invalidJson.status, "error");
});

test("UI source includes required Korean labels", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile("src/app/shopling-product-upload-runner/page.tsx", "utf8");
  const component = await readFile(
    "src/components/shopling-product-upload-runner/ShoplingProductUploadRunner.tsx",
    "utf8",
  );
  const source = `${page}\n${component}`;

  for (const text of [
    "샵플링 상품등록 실행기",
    "실재고 시트 행 번호",
    "채널",
    "전체 6채널",
    "기본값은 도매1~도매4, 소매1~소매2 전체 등록입니다.",
    "이미 goods_key 있으면 스킵",
    "상품등록 실행",
    "실행 결과",
    "최근 실행 결과 가져오기",
    "결과 가져오는 중...",
    "OK",
    "SKIP",
    "FAIL",
    "행",
    "채널",
    "코드",
    "성공 여부",
    "goods_key",
    "ptn_goods_cd",
    "실제 완료 여부는 GitHub Actions 실행이 끝난 뒤 ‘최근 실행 결과 가져오기’로 확인하세요.",
    "요청 추적 ID",
    "최근 실행 결과 가져오기는 이 요청 추적 ID와 일치하는 결과를 우선 조회합니다.",
  ]) {
    assert.equal(source.includes(text), true, text);
  }
});

test("UI hides sleep and raw dump inputs and explains SaaS-safe logging", async () => {
  const { readFile } = await import("node:fs/promises");
  const component = await readFile(
    "src/components/shopling-product-upload-runner/ShoplingProductUploadRunner.tsx",
    "utf8",
  );

  assert.equal(component.includes("실행 간격 초"), false);
  assert.equal(component.includes("실행 간격은 안정성을 위해 1.2초로 고정됩니다."), true);
  assert.equal(component.includes("요청/응답 XML 덤프 저장"), false);
  assert.equal(component.includes('name="dump"'), false);
  assert.equal(component.includes("민감정보 보호를 위해 원문 XML 요청/응답은 기본 저장하지 않습니다."), true);
  assert.equal(component.includes("실행 결과에는 행 번호, 채널, 성공/실패/SKIP, goods_key 중심의 요약 정보만 표시됩니다."), true);
});

test("client request sends fixed sleep and does not read dump form data", async () => {
  const { readFile } = await import("node:fs/promises");
  const component = await readFile(
    "src/components/shopling-product-upload-runner/ShoplingProductUploadRunner.tsx",
    "utf8",
  );

  assert.equal(component.includes('sleep: "1.2"'), true);
  assert.equal(component.includes('dump: false'), true);
  assert.equal(component.includes('formData.get("sleep")'), false);
  assert.equal(component.includes('formData.get("dump")'), false);
  assert.equal(component.includes("shoplingProductUpload.currentRequestId"), true);
  assert.equal(component.includes("window.localStorage.setItem(CURRENT_REQUEST_ID_STORAGE_KEY, data.requestId)"), true);
  assert.equal(component.includes("window.localStorage.getItem(CURRENT_REQUEST_ID_STORAGE_KEY)"), true);
  assert.equal(component.includes("request_id=${encodeURIComponent(currentRequestId)}"), true);
});


test("runner implementation keeps process execution safety constraints", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/lib/shoplingProductUploadRunner.ts", "utf8");

  assert.equal(source.includes("shell: true"), false);
  assert.equal(source.includes("exec("), false);
  assert.doesNotMatch(source, /PowerShell|powershell|pwsh/i);
  assert.match(source, /spawn\(python, command\.args/);
  assert.match(source, /SHOPLING_PRODUCT_UPLOAD_RUN_MODE === "github_actions"/);
});

test("GitHub Actions result helper keeps unmatched request_id polling instead of failing early", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/runs?")) {
      return new Response(JSON.stringify({ workflow_runs: [
        { id: 44, status: "completed", conclusion: "failure", html_url: "https://github.com/run/44" },
      ] }), { status: 200 });
    }
    return new Response(JSON.stringify({ artifacts: [] }), { status: 200 });
  };
  const previousEnabled = process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED;
  process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED = "1";
  try {
    await withGithubActionsEnv({}, async () => {
      const result = await fetchShoplingProductUploadActionsResult("shopling-not-matched-yet");
      assert.equal(result.status, "pending");
      assert.equal(result.phase, "request_sent");
      assert.equal(result.requestId, "shopling-not-matched-yet");
      assert.match(result.message, /GitHub Actions 실행을 확인하는 중입니다/);
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) delete process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED;
    else process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED = previousEnabled;
  }
});

test("GitHub Actions result helper treats missing artifact as pending, not failure", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/runs?")) {
      return new Response(JSON.stringify({ workflow_runs: [
        { id: 55, status: "completed", conclusion: "success", html_url: "https://github.com/run/55" },
      ] }), { status: 200 });
    }
    return new Response(JSON.stringify({ artifacts: [] }), { status: 200 });
  };
  const previousEnabled = process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED;
  process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED = "1";
  try {
    await withGithubActionsEnv({}, async () => {
      const result = await fetchShoplingProductUploadActionsResult();
      assert.equal(result.status, "pending");
      assert.equal(result.phase, "completed_no_artifact");
      assert.equal(result.runId, 55);
      assert.match(result.message, /결과 파일이 아직 준비되지 않았습니다/);
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) delete process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED;
    else process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED = previousEnabled;
  }
});

test("GitHub Actions result helper returns confirmed failure for failed completed run", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ workflow_runs: [
    { id: 66, status: "completed", conclusion: "failure", html_url: "https://github.com/run/66" },
  ] }), { status: 200 });
  const previousEnabled = process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED;
  process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED = "1";
  try {
    await withGithubActionsEnv({}, async () => {
      const result = await fetchShoplingProductUploadActionsResult();
      assert.equal(result.status, "error");
      assert.equal(result.phase, "failed");
      assert.equal(result.runId, 66);
      assert.equal(result.runStatus, "completed");
      assert.equal(result.runConclusion, "failure");
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) delete process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED;
    else process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED = previousEnabled;
  }
});

test("GitHub Actions result helper ignores unrelated old artifact without result_summary when request_id is provided", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/runs?")) return new Response(JSON.stringify({ workflow_runs: [{ id: 23, status: "completed", conclusion: "success", html_url: "https://github.com/run/23" }] }), { status: 200 });
    if (String(url).includes("/artifacts")) return new Response(JSON.stringify({ artifacts: [{ name: "shopling-upload-logs-queue-old", archive_download_url: "https://api.github.com/old.zip" }] }), { status: 200 });
    return new Response(zipSync({ "logs/run_20260623_114106.txt": strToU8("old run"), "queue/queue_20260623_114106.json": strToU8(JSON.stringify({ request_id: "shopling-old" })) }), { status: 200 });
  };
  const previousEnabled = process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED;
  process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED = "1";
  try {
    await withGithubActionsEnv({}, async () => {
      const result = await fetchShoplingProductUploadActionsResult("shopling-20260628T091601Z-current");
      assert.equal(result.status, "pending");
      assert.equal(result.phase, "request_sent");
      assert.match(result.message, /현재 요청 ID와 일치하는 GitHub Actions 실행을 찾는 중입니다/);
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) delete process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED;
    else process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED = previousEnabled;
  }
});

test("GitHub Actions result helper reports missing result_summary only for matching request artifact", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/runs?")) return new Response(JSON.stringify({ workflow_runs: [{ id: 28, status: "completed", conclusion: "success", html_url: "https://github.com/run/28" }] }), { status: 200 });
    if (String(url).includes("/artifacts")) return new Response(JSON.stringify({ artifacts: [{ name: "shopling-upload-logs-queue-current", archive_download_url: "https://api.github.com/current.zip" }] }), { status: 200 });
    return new Response(zipSync({ "queue/request.json": strToU8(JSON.stringify({ request_id: "shopling-current" })) }), { status: 200 });
  };
  const previousEnabled = process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED;
  process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED = "1";
  try {
    await withGithubActionsEnv({}, async () => {
      const result = await fetchShoplingProductUploadActionsResult("shopling-current");
      assert.equal(result.status, "error");
      assert.equal(result.phase, "completed_no_artifact");
      assert.match(result.message, /현재 요청의 artifact에서 result_summary\.json을 찾지 못했습니다/);
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) delete process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED;
    else process.env.SHOPLING_PRODUCT_UPLOAD_ENABLED = previousEnabled;
  }
});
