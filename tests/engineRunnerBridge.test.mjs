import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildEngineDispatchPreview,
  engineRunnerConfigs,
} from "../src/lib/engineRunnerConfig.ts";
import { moduleRegistry } from "../src/lib/moduleRegistry.ts";
import { GET as getEngineRunners } from "../src/app/api/engine-runners/route.ts";
import { POST as postDispatchPreview } from "../src/app/api/engine-runners/dispatch-preview/route.ts";
import { POST as postDispatch } from "../src/app/api/engine-runners/dispatch/route.ts";
import { GET as getRunnerRuns } from "../src/app/api/engine-runners/runs/route.ts";
import { listWorkflowRunArtifacts, listWorkflowRuns } from "../src/lib/githubActionsRuns.ts";

test("runner configs include both external repos", () => {
  assert.deepEqual(
    engineRunnerConfigs.map(({ repo }) => repo),
    [
      "andysong111/andysong111-keyword-engine-soon",
      "andysong111/product-detail-page-auto",
    ],
  );
});

test("engine runner config API does not expose token value", async () => {
  process.env.GITHUB_ENGINE_DISPATCH_TOKEN = "secret-test-token";
  const response = getEngineRunners();
  const body = await response.json();

  assert.equal(body.githubDispatchTokenConfigured, true);
  assert.doesNotMatch(JSON.stringify(body), /secret-test-token/);
  delete process.env.GITHUB_ENGINE_DISPATCH_TOKEN;
});

test("dispatch preview returns previewOnly true", async () => {
  const response = await postDispatchPreview(
    new Request("http://localhost/api/engine-runners/dispatch-preview", {
      method: "POST",
      body: JSON.stringify({
        kind: "keyword_engine",
        mode: "dry_run",
        inputs: { goods_key: "BATH001", seed_keyword: "bath towel" },
      }),
    }),
  );
  const body = await response.json();

  assert.equal(body.previewOnly, true);
  assert.equal(body.repo, "andysong111/andysong111-keyword-engine-soon");
});

test("dispatch route blocks when token is missing", async () => {
  delete process.env.GITHUB_ENGINE_DISPATCH_TOKEN;
  const response = await postDispatch(
    new Request("http://localhost/api/engine-runners/dispatch", {
      method: "POST",
      body: JSON.stringify({ kind: "detail_page_engine", mode: "generate_artifacts", inputs: { product_code: "BATH001", source_link: "https://example.com" } }),
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 501);
  assert.equal(body.message, "GitHub Actions dispatch is not configured yet.");
});


test("dispatch route rejects invalid runner kind", async () => {
  const response = await postDispatch(
    new Request("http://localhost/api/engine-runners/dispatch", {
      method: "POST",
      body: JSON.stringify({ kind: "unknown", mode: "dry_run", inputs: { goods_key: "BATH001" } }),
    }),
  );

  assert.equal(response.status, 400);
});

test("dispatch route rejects invalid mode", async () => {
  const response = await postDispatch(
    new Request("http://localhost/api/engine-runners/dispatch", {
      method: "POST",
      body: JSON.stringify({ kind: "keyword_engine", mode: "generate_artifacts", inputs: { goods_key: "BATH001" } }),
    }),
  );

  assert.equal(response.status, 400);
});

test("dispatch route maps keyword inputs correctly", async () => {
  process.env.GITHUB_ENGINE_DISPATCH_TOKEN = "secret-test-token";
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(null, { status: 204 });
  };

  try {
    const response = await postDispatch(new Request("http://localhost/api/engine-runners/dispatch", {
      method: "POST",
      body: JSON.stringify({ kind: "keyword_engine", mode: "dry_run", inputs: { goods_key: "BATH001" } }),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(requestBody.inputs, { goods_key: "BATH001", seed_keyword: "", mode: "dry_run" });
    assert.doesNotMatch(JSON.stringify(await response.json()), /secret-test-token/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GITHUB_ENGINE_DISPATCH_TOKEN;
  }
});

test("dispatch route maps detail page inputs correctly", async () => {
  process.env.GITHUB_ENGINE_DISPATCH_TOKEN = "secret-test-token";
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(null, { status: 204 });
  };

  try {
    const response = await postDispatch(new Request("http://localhost/api/engine-runners/dispatch", {
      method: "POST",
      body: JSON.stringify({ kind: "detail_page_engine", mode: "generate_artifacts", inputs: { product_code: "BATH001", source_link: "https://example.com/1", source_links: "https://example.com/2", planning_point: "premium", option_info: "blue", target: "shop" } }),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(requestBody.inputs, { product_code: "BATH001", source_link: "https://example.com/1", source_links: "https://example.com/2", planning_point: "premium", option_info: "blue", target: "shop", mode: "generate_artifacts" });
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GITHUB_ENGINE_DISPATCH_TOKEN;
  }
});

test("dispatch preview validates mode", () => {
  assert.throws(
    () => buildEngineDispatchPreview({ kind: "keyword_engine", mode: "generate_artifacts" }),
    /Unsupported engine runner mode/,
  );
});

test("Keyword Engine Runner page renders safety banner and expected artifacts", async () => {
  const page = await readFile(new URL("../src/app/keyword-engine-runner/page.tsx", import.meta.url), "utf8");
  assert.match(page, /로컬 PowerShell을 실행하지/);
  assert.match(page, /Shopling을 호출하지/);
  assert.match(page, /키워드 엔진 실행기/);
  assert.match(page, /샵플링 상품코드\(goods_key\) 필수/);
  assert.match(page, /시드 키워드\(선택\)/);
  assert.match(page, /비워두면 상품코드 기준으로 자동 진행합니다/);
  const consoleSource = await readFile(new URL("../src/components/engine-runners/EngineRunnerConsole.tsx", import.meta.url), "utf8");
  assert.match(consoleSource, /오늘 할 일/);
  assert.match(consoleSource, /상품번호 입력/);
  assert.match(consoleSource, /키워드 엔진 실행/);
  assert.match(consoleSource, /결과물 가져와서 검토/);
  assert.match(consoleSource, /키워드 엔진 실행하기/);
  assert.match(consoleSource, /실행 결과 확인하기/);
  assert.match(consoleSource, /결과물 가져와서 검토하기/);
  assert.match(consoleSource, /가져온 키워드는 샵플링에 자동 반영되지 않습니다/);
  assert.match(consoleSource, /기술 정보 보기/);
  assert.match(consoleSource, /raw JSON\/debug output/);
  assert.match(consoleSource, /최근 엔진 실행 결과/);
  assert.match(consoleSource, /GitHub는 run id를 즉시 반환하지 않습니다/);
  assert.ok(engineRunnerConfigs.find((config) => config.kind === "keyword_engine")?.expectedArtifacts.includes("keyword_mvp_approval_sheet.csv"));
  assert.equal(engineRunnerConfigs.find((config) => config.kind === "keyword_engine")?.expectedArtifactName, "keyword-engine-mvp-output");
});

test("Detail Page Engine Runner page renders safety banner and expected artifacts", async () => {
  const page = await readFile(new URL("../src/app/detail-page-engine-runner/page.tsx", import.meta.url), "utf8");
  assert.match(page, /1688\/OpenAI를 직접 호출하지/);
  assert.match(page, /상세페이지를 자동 게시하지/);
  assert.match(page, /상세페이지 엔진 실행기/);
  assert.match(page, /1688 상품 링크\(필수\)/);
  assert.match(page, /상품코드\(선택, 비워두면 자동 생성\)/);
  const consoleSource = await readFile(new URL("../src/components/engine-runners/EngineRunnerConsole.tsx", import.meta.url), "utf8");
  assert.match(consoleSource, /오늘 할 일/);
  assert.match(consoleSource, /1688 링크 입력/);
  assert.match(consoleSource, /상세페이지 엔진 실행/);
  assert.match(consoleSource, /결과물 가져와서 검토/);
  assert.match(consoleSource, /상세페이지 엔진 실행하기/);
  assert.match(consoleSource, /실행 결과 확인하기/);
  assert.match(consoleSource, /결과물 가져와서 검토하기/);
  assert.match(consoleSource, /가져온 상세페이지는 자동 게시되지 않습니다/);
  assert.match(consoleSource, /기술 정보 보기/);
  assert.match(consoleSource, /raw JSON\/debug output/);
  assert.match(consoleSource, /검토용 상세페이지 생성/);
  assert.ok(engineRunnerConfigs.find((config) => config.kind === "detail_page_engine")?.expectedArtifacts.includes("detailpage_final.html"));
  assert.equal(engineRunnerConfigs.find((config) => config.kind === "detail_page_engine")?.expectedArtifactName, "detail-page-engine-output");
});

test("Dashboard links point to runner pages", () => {
  assert.equal(moduleRegistry.find((module) => module.id === "keyword-engine")?.route, "/keyword-engine-runner");
  assert.equal(moduleRegistry.find((module) => module.id === "detail-page-engine")?.route, "/detail-page-engine-runner");
});


test("run listing API rejects invalid runner kind", async () => {
  const response = await getRunnerRuns(new Request("http://localhost/api/engine-runners/runs?kind=unknown"));
  assert.equal(response.status, 400);
});

test("run listing API returns not_configured when token is missing", async () => {
  delete process.env.GITHUB_ENGINE_DISPATCH_TOKEN;
  const response = await getRunnerRuns(new Request("http://localhost/api/engine-runners/runs?kind=keyword_engine"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "not_configured");
  assert.deepEqual(body.runs, []);
});

test("run listing client calls the correct workflow runs URL and does not expose token", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let auth = "";
  globalThis.fetch = async (url, init) => {
    calledUrl = String(url);
    auth = init.headers.Authorization;
    return Response.json({ workflow_runs: [{ id: 123, name: "Keyword Engine Runner", status: "completed", conclusion: "success", event: "workflow_dispatch", head_branch: "main", head_sha: "abc", created_at: "2026-06-17T00:00:00Z", updated_at: "2026-06-17T00:01:00Z", html_url: "https://github.com/run", run_number: 7, run_attempt: 1 }] });
  };

  try {
    const config = engineRunnerConfigs.find((runner) => runner.kind === "keyword_engine");
    const runs = await listWorkflowRuns({ ...config, token: "secret-test-token", perPage: 10 });
    assert.equal(calledUrl, "https://api.github.com/repos/andysong111/andysong111-keyword-engine-soon/actions/workflows/keyword-engine-runner.yml/runs?per_page=10");
    assert.equal(auth, "Bearer secret-test-token");
    assert.doesNotMatch(JSON.stringify(runs), /secret-test-token/);
    assert.equal(runs[0].runNumber, 7);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("artifact listing client calls the correct artifacts URL and detects expected names", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  globalThis.fetch = async (url) => {
    calledUrl = String(url);
    return Response.json({ artifacts: [{ id: 456, name: "detail-page-engine-output", size_in_bytes: 100, expired: false, created_at: "2026-06-17T00:00:00Z", updated_at: "2026-06-17T00:01:00Z", archive_download_url: "https://api.github.com/artifact.zip" }] });
  };

  try {
    const config = engineRunnerConfigs.find((runner) => runner.kind === "detail_page_engine");
    const artifacts = await listWorkflowRunArtifacts({ ...config, token: "secret-test-token" }, 123);
    assert.equal(calledUrl, "https://api.github.com/repos/andysong111/product-detail-page-auto/actions/runs/123/artifacts");
    assert.equal(artifacts[0].expected, true);
    assert.equal(artifacts[0].archiveDownloadUrlAvailable, true);
    assert.doesNotMatch(JSON.stringify(artifacts), /secret-test-token/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("expected artifact names are detected for both engines", async () => {
  assert.equal(engineRunnerConfigs.find((config) => config.kind === "keyword_engine")?.expectedArtifactName, "keyword-engine-mvp-output");
  assert.equal(engineRunnerConfigs.find((config) => config.kind === "detail_page_engine")?.expectedArtifactName, "detail-page-engine-output");
});

test("No local shell execution utility is introduced", async () => {
  const files = [
    "../src/lib/engineRunnerConfig.ts",
    "../src/app/api/engine-runners/dispatch/route.ts",
    "../src/app/api/engine-runners/dispatch-preview/route.ts",
    "../src/lib/githubActionsDispatch.ts",
    "../src/lib/githubActionsRuns.ts",
    "../src/app/api/engine-runners/runs/route.ts",
    "../src/components/engine-runners/EngineRunnerConsole.tsx",
  ];

  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /child_process|powershell|pwsh|exec\(|spawn\(|Shopling.*apply|publish.*Shopling|1688.*fetch|OpenAI|image generation/i);
  }
});

test("detail page dispatch preview generates a DP product_code when blank", async () => {
  const originalRandom = Math.random;
  Math.random = () => 0.123456789;

  try {
    const response = await postDispatchPreview(
      new Request("http://localhost/api/engine-runners/dispatch-preview", {
        method: "POST",
        body: JSON.stringify({
          kind: "detail_page_engine",
          mode: "generate_artifacts",
          inputs: { product_code: "", source_link: "https://example.com/source" },
        }),
      }),
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.match(body.inputs.product_code, /^DP-\d{8}T\d{6}Z-[A-Z0-9]{6}$/);
    assert.equal(body.inputs.source_link, "https://example.com/source");
  } finally {
    Math.random = originalRandom;
  }
});

test("client form helper preserves generated detail page product_code for following dispatch", async () => {
  const { persistGeneratedDetailPageProductCode } = await import("../src/lib/engineRunnerFormState.ts");
  const productCodeInput = { value: "" };
  const form = {
    querySelector(selector) {
      return selector === '[name="product_code"]' ? productCodeInput : null;
    },
  };

  persistGeneratedDetailPageProductCode("detail_page_engine", form, { inputs: { product_code: "DP-20260618T010203Z-ABC123" } });

  assert.equal(productCodeInput.value, "DP-20260618T010203Z-ABC123");
});

test("dispatch after preview uses exact generated detail page product_code", async () => {
  const originalRandom = Math.random;
  const originalFetch = globalThis.fetch;
  let requestBody;
  Math.random = () => 0.23456789;
  process.env.GITHUB_ENGINE_DISPATCH_TOKEN = "secret-test-token";
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(null, { status: 204 });
  };

  try {
    const previewResponse = await postDispatchPreview(
      new Request("http://localhost/api/engine-runners/dispatch-preview", {
        method: "POST",
        body: JSON.stringify({ kind: "detail_page_engine", mode: "generate_artifacts", inputs: { product_code: "", source_link: "https://example.com/source" } }),
      }),
    );
    const previewBody = await previewResponse.json();
    const generatedProductCode = previewBody.inputs.product_code;

    const dispatchResponse = await postDispatch(new Request("http://localhost/api/engine-runners/dispatch", {
      method: "POST",
      body: JSON.stringify({ kind: "detail_page_engine", mode: "generate_artifacts", inputs: { product_code: generatedProductCode, source_link: "https://example.com/source" } }),
    }));

    assert.equal(dispatchResponse.status, 200);
    assert.equal(requestBody.inputs.product_code, generatedProductCode);
  } finally {
    Math.random = originalRandom;
    globalThis.fetch = originalFetch;
    delete process.env.GITHUB_ENGINE_DISPATCH_TOKEN;
  }
});

test("manual detail page product_code overrides generated preview value", async () => {
  const { persistGeneratedDetailPageProductCode } = await import("../src/lib/engineRunnerFormState.ts");
  const productCodeInput = { value: "MANUAL-001" };
  const form = {
    querySelector(selector) {
      return selector === '[name="product_code"]' ? productCodeInput : null;
    },
  };

  persistGeneratedDetailPageProductCode("detail_page_engine", form, { inputs: { product_code: "DP-20260618T010203Z-ABC123" } });

  assert.equal(productCodeInput.value, "MANUAL-001");
});

test("source_link-only detail page dispatch works when preview is skipped", async () => {
  process.env.GITHUB_ENGINE_DISPATCH_TOKEN = "secret-test-token";
  const originalRandom = Math.random;
  const originalFetch = globalThis.fetch;
  let requestBody;
  Math.random = () => 0.3456789;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(null, { status: 204 });
  };

  try {
    const response = await postDispatch(new Request("http://localhost/api/engine-runners/dispatch", {
      method: "POST",
      body: JSON.stringify({ kind: "detail_page_engine", mode: "generate_artifacts", inputs: { product_code: "", source_link: "https://example.com/source" } }),
    }));

    assert.equal(response.status, 200);
    assert.match(requestBody.inputs.product_code, /^DP-\d{8}T\d{6}Z-[A-Z0-9]{6}$/);
    assert.equal(requestBody.inputs.source_link, "https://example.com/source");
  } finally {
    Math.random = originalRandom;
    globalThis.fetch = originalFetch;
    delete process.env.GITHUB_ENGINE_DISPATCH_TOKEN;
  }
});
