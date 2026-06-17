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
        inputs: { goods_keys: "BATH001", seed_keyword: "bath towel" },
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
      body: JSON.stringify({ kind: "detail_page_engine", mode: "generate_artifacts" }),
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 501);
  assert.equal(body.message, "GitHub Actions dispatch is not configured yet.");
});

test("dispatch preview validates mode", () => {
  assert.throws(
    () => buildEngineDispatchPreview({ kind: "keyword_engine", mode: "generate_artifacts" }),
    /Unsupported engine runner mode/,
  );
});

test("Keyword Engine Runner page renders safety banner and expected artifacts", async () => {
  const page = await readFile(new URL("../src/app/keyword-engine-runner/page.tsx", import.meta.url), "utf8");
  assert.match(page, /does not run local PowerShell/);
  assert.match(page, /does not call Shopling/);
  assert.ok(engineRunnerConfigs.find((config) => config.kind === "keyword_engine")?.expectedArtifacts.includes("keyword_mvp_approval_sheet.csv"));
});

test("Detail Page Engine Runner page renders safety banner and expected artifacts", async () => {
  const page = await readFile(new URL("../src/app/detail-page-engine-runner/page.tsx", import.meta.url), "utf8");
  assert.match(page, /does not call 1688\/OpenAI from OPS CENTER/);
  assert.match(page, /does not publish pages/);
  assert.ok(engineRunnerConfigs.find((config) => config.kind === "detail_page_engine")?.expectedArtifacts.includes("detailpage_final.html"));
});

test("Dashboard links point to runner pages", () => {
  assert.equal(moduleRegistry.find((module) => module.id === "keyword-engine")?.route, "/keyword-engine-runner");
  assert.equal(moduleRegistry.find((module) => module.id === "detail-page-engine")?.route, "/detail-page-engine-runner");
});

test("No local shell execution utility is introduced", async () => {
  const files = [
    "../src/lib/engineRunnerConfig.ts",
    "../src/app/api/engine-runners/dispatch/route.ts",
    "../src/app/api/engine-runners/dispatch-preview/route.ts",
  ];

  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /child_process|powershell|pwsh|exec\(|spawn\(/i);
  }
});
