import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { engineRunnerConfigs } from "../src/lib/engineRunnerConfig.ts";
import {
  downloadWorkflowArtifact,
  extractExpectedArtifactFiles,
} from "../src/lib/githubActionsArtifacts.ts";
import { POST as postImportPreview } from "../src/app/api/engine-runners/artifacts/import-preview/route.ts";

function u16(n) {
  return [n & 255, (n >> 8) & 255];
}
function u32(n) {
  return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255];
}
function crc32(bytes) {
  let crc = -1;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}
function zip(entries, options = {}) {
  const encoder = new TextEncoder();
  const localChunks = [];
  const centralChunks = [];
  let localOffset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(value);
    const crc = crc32(data);
    const useDataDescriptor = options.dataDescriptor === true;
    const local = Uint8Array.from([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(useDataDescriptor ? 0x08 : 0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(useDataDescriptor ? 0 : crc),
      ...u32(useDataDescriptor ? 0 : data.length),
      ...u32(useDataDescriptor ? 0 : data.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...nameBytes,
      ...data,
      ...(useDataDescriptor ? [...u32(0x08074b50), ...u32(crc), ...u32(data.length), ...u32(data.length)] : []),
    ]);
    localChunks.push(local);
    centralChunks.push(Uint8Array.from([
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(useDataDescriptor ? 0x08 : 0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(localOffset),
      ...nameBytes,
    ]));
    localOffset += local.length;
  }
  const centralOffset = localOffset;
  const centralSize = centralChunks.reduce((n, c) => n + c.length, 0);
  const eocd = Uint8Array.from([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(centralChunks.length),
    ...u16(centralChunks.length),
    ...u32(centralSize),
    ...u32(centralOffset),
    ...u16(0),
  ]);
  const chunks = [...localChunks, ...centralChunks, eocd];
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

const keywordZip = zip({
  "keyword_mvp_approval_sheet.csv": "goods_key,title\nBATH001,Towel",
  "keyword_mvp_manual_candidates.csv": "goods_key,title\nBATH002,Mat",
  "keyword_mvp_summary.md": "# Summary",
  "unexpected.txt": "ignore me",
});
const detailZip = zip({
  "detailpage_final.html": "<main>Draft</main>",
  "detailpage_render_report.json": '{"product_code":"BATH001"}',
  "multi_source_summary.json": '{"sources":[]}',
  "generated_source/hero.png": "binary-not-returned",
});

test("expected keyword files are extracted and unexpected files ignored", () => {
  const extracted = extractExpectedArtifactFiles("keyword_engine", keywordZip);
  assert.equal(extracted.files["keyword_mvp_summary.md"], "# Summary");
  assert.equal(extracted.files["unexpected.txt"], undefined);
  assert.deepEqual(extracted.missingFiles, []);
  assert.ok(extracted.skippedFiles.includes("unexpected.txt"));
});

test("expected detail page files are extracted and generated_source is metadata only", () => {
  const extracted = extractExpectedArtifactFiles(
    "detail_page_engine",
    detailZip,
  );
  assert.equal(extracted.files["detailpage_final.html"], "<main>Draft</main>");
  assert.equal(extracted.files["generated_source/hero.png"], undefined);
  assert.deepEqual(extracted.generatedSourceFiles, [
    "generated_source/hero.png",
  ]);
});

test("path traversal zip entries are ignored", () => {
  const extracted = extractExpectedArtifactFiles(
    "keyword_engine",
    zip({ "../secret.txt": "no", "keyword_mvp_approval_sheet.csv": "ok" }),
  );
  assert.equal(extracted.files["../secret.txt"], undefined);
  assert.ok(extracted.skippedFiles.includes("../secret.txt"));
});

test("oversized files are rejected", () => {
  assert.throws(
    () =>
      extractExpectedArtifactFiles(
        "keyword_engine",
        zip({
          "keyword_mvp_approval_sheet.csv": "x".repeat(2 * 1024 * 1024 + 1),
        }),
      ),
    /safe preview limit/,
  );
});

test("artifact download uses configured repo only and does not return token", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  globalThis.fetch = async (url) => {
    calledUrl = String(url);
    return new Response(keywordZip);
  };
  try {
    const config = engineRunnerConfigs.find(
      (runner) => runner.kind === "keyword_engine",
    );
    const bytes = await downloadWorkflowArtifact(
      { ...config, token: "secret-test-token" },
      456,
    );
    assert.equal(
      calledUrl,
      "https://api.github.com/repos/andysong111/andysong111-keyword-engine-soon/actions/artifacts/456/zip",
    );
    assert.doesNotMatch(
      JSON.stringify(Array.from(bytes.slice(0, 5))),
      /secret-test-token/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("artifact import rejects invalid runner kind", async () => {
  const response = await postImportPreview(
    new Request(
      "http://localhost/api/engine-runners/artifacts/import-preview",
      {
        method: "POST",
        body: JSON.stringify({ kind: "bad", runId: 1, artifactId: 2 }),
      },
    ),
  );
  assert.equal(response.status, 400);
});

test("artifact import returns not_configured when token is missing", async () => {
  delete process.env.GITHUB_ENGINE_DISPATCH_TOKEN;
  const response = await postImportPreview(
    new Request(
      "http://localhost/api/engine-runners/artifacts/import-preview",
      {
        method: "POST",
        body: JSON.stringify({
          kind: "keyword_engine",
          runId: 1,
          artifactId: 2,
        }),
      },
    ),
  );
  const body = await response.json();
  assert.equal(body.status, "not_configured");
});

test("artifact import returns normalized payload without token", async () => {
  process.env.GITHUB_ENGINE_DISPATCH_TOKEN = "secret-test-token";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(keywordZip);
  try {
    const response = await postImportPreview(
      new Request(
        "http://localhost/api/engine-runners/artifacts/import-preview",
        {
          method: "POST",
          body: JSON.stringify({
            kind: "keyword_engine",
            runId: 123,
            artifactId: 456,
          }),
        },
      ),
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(
      body.source.repo,
      "andysong111/andysong111-keyword-engine-soon",
    );
    assert.equal(body.reviewRoute, "/keyword-review-queue");
    assert.doesNotMatch(JSON.stringify(body), /secret-test-token/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GITHUB_ENGINE_DISPATCH_TOKEN;
  }
});


test("artifact import missing expected files returns Korean diagnostics with found safe filenames", async () => {
  process.env.GITHUB_ENGINE_DISPATCH_TOKEN = "secret-test-token";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      zip({
        "output/mvp/keyword_mvp_result.json": "{}",
        "../keyword_mvp_approval_sheet.csv": "unsafe",
      }),
    );
  try {
    const response = await postImportPreview(
      new Request("http://localhost/api/engine-runners/artifacts/import-preview", {
        method: "POST",
        body: JSON.stringify({ kind: "keyword_engine", runId: 123, artifactId: 456 }),
      }),
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, false);
    assert.equal(body.status, "missing_expected_files");
    assert.match(body.message, /예상 파일을 찾지 못했습니다/);
    assert.match(body.message, /keyword_mvp_approval_sheet\.csv/);
    assert.match(body.message, /ZIP 안에서 발견한 파일: output\/mvp\/keyword_mvp_result\.json/);
    assert.doesNotMatch(body.message, /secret-test-token/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GITHUB_ENGINE_DISPATCH_TOKEN;
  }
});

test("artifact import returns 502 JSON error on GitHub artifact download failure", async () => {
  process.env.GITHUB_ENGINE_DISPATCH_TOKEN = "secret-test-token";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("no", { status: 500 });
  try {
    const response = await postImportPreview(
      new Request(
        "http://localhost/api/engine-runners/artifacts/import-preview",
        {
          method: "POST",
          body: JSON.stringify({
            kind: "detail_page_engine",
            runId: 123,
            artifactId: 456,
          }),
        },
      ),
    );
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(body.status, "github_actions_error");
    assert.doesNotMatch(JSON.stringify(body), /secret-test-token/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GITHUB_ENGINE_DISPATCH_TOKEN;
  }
});

test("UI source includes artifact import buttons and staged handoff detection", async () => {
  const runner = await readFile(
    new URL(
      "../src/components/engine-runners/EngineRunnerConsole.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(runner, /결과 가져오기 및 검토 시작/);
  assert.doesNotMatch(runner, /키워드 검토 단계 열기/);
  assert.match(runner, /router\.push\(reviewRoute\)/);
  assert.match(runner, /sessionStorage\.setItem/);
  const keywordPage = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(keywordPage, /키워드 결과물을 불러왔습니다/);
  assert.match(keywordPage, /아직 가져온 키워드 결과물이 없습니다/);
  assert.match(keywordPage, /키워드 엔진 실행기로 이동/);
  assert.match(keywordPage, /수동으로 CSV 붙여넣기 \/ 업로드하기/);
  assert.match(keywordPage, /setFinalConfirmation\(false\)/);
  const detailPage = await readFile(
    new URL("../src/app/detail-page-draft-review/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(detailPage, /Imported detail page engine artifact is ready/);
  assert.match(detailPage, /Nothing was published/);
});

test("safety restrictions remain absent from artifact import implementation", async () => {
  const files = [
    "../src/lib/githubActionsArtifacts.ts",
    "../src/app/api/engine-runners/artifacts/import-preview/route.ts",
    "../src/components/engine-runners/EngineRunnerConsole.tsx",
  ];
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /child_process|powershell|pwsh|spawn\(|exec\(/i,
    );
    assert.doesNotMatch(
      source,
      /\/api\/shopling|api\.1688|openai\.chat|images\.generate/i,
    );
  }
});

test("artifact ZIP import supports root, single folder, output, and artifacts layouts safely", () => {
  for (const prefix of [
    "",
    "keyword-engine-mvp-output/",
    "output/",
    "artifacts/",
    "output/mvp/",
  ]) {
    const extracted = extractExpectedArtifactFiles(
      "keyword_engine",
      zip({
        [`${prefix}keyword_mvp_approval_sheet.csv`]:
          "goods_key,title\nBATH001,Towel",
        [`${prefix}keyword_mvp_manual_candidates.csv`]:
          "goods_key,title\nBATH002,Mat",
        [`${prefix}keyword_mvp_summary.md`]: "# Summary",
      }),
    );
    assert.equal(
      extracted.files["keyword_mvp_approval_sheet.csv"],
      "goods_key,title\nBATH001,Towel",
    );
    assert.deepEqual(extracted.missingFiles, []);
  }
});


test("output/mvp keyword artifacts include required and optional allowlisted files", () => {
  const extracted = extractExpectedArtifactFiles(
    "keyword_engine",
    zip({
      "output/mvp/keyword_mvp_approval_sheet.csv": "goods_key,title\nBATH001,Towel",
      "output/mvp/keyword_mvp_manual_candidates.csv": "goods_key,title\nBATH002,Mat",
      "output/mvp/keyword_mvp_summary.md": "# Summary",
      "output/mvp/keyword_mvp_result.csv": "goods_key,status\nBATH001,ok",
      "output/mvp/keyword_mvp_result.json": "{\"ok\":true}",
      "output/mvp/keyword_mvp_auto_promotion_audit.csv": "goods_key,decision\nBATH001,review",
      "output/mvp/not_allowed.txt": "ignored",
    }),
  );
  assert.equal(extracted.files["keyword_mvp_approval_sheet.csv"], "goods_key,title\nBATH001,Towel");
  assert.equal(extracted.files["keyword_mvp_manual_candidates.csv"], "goods_key,title\nBATH002,Mat");
  assert.equal(extracted.files["keyword_mvp_summary.md"], "# Summary");
  assert.equal(extracted.files["keyword_mvp_result.csv"], "goods_key,status\nBATH001,ok");
  assert.equal(extracted.files["keyword_mvp_result.json"], "{\"ok\":true}");
  assert.equal(extracted.files["keyword_mvp_auto_promotion_audit.csv"], "goods_key,decision\nBATH001,review");
  assert.equal(extracted.files["not_allowed.txt"], undefined);
  assert.ok(extracted.foundSafeFiles.includes("output/mvp/not_allowed.txt"));
  assert.deepEqual(extracted.missingFiles, []);
});

test("path traversal and absolute zip entries are rejected before basename matching", () => {
  const extracted = extractExpectedArtifactFiles(
    "keyword_engine",
    zip({
      "../keyword_mvp_manual_candidates.csv": "no",
      "output/../keyword_mvp_summary.md": "no",
      "/keyword_mvp_result.csv": "no",
      "C:/keyword_mvp_result.json": "no",
      "output\\mvp\\keyword_mvp_auto_promotion_audit.csv": "no",
      "output/mvp/keyword_mvp_approval_sheet.csv": "ok",
    }),
  );
  assert.equal(extracted.files["keyword_mvp_manual_candidates.csv"], undefined);
  assert.equal(extracted.files["keyword_mvp_summary.md"], undefined);
  assert.equal(extracted.files["keyword_mvp_result.csv"], undefined);
  assert.equal(extracted.files["keyword_mvp_result.json"], undefined);
  assert.equal(extracted.files["keyword_mvp_auto_promotion_audit.csv"], undefined);
  assert.equal(extracted.files["keyword_mvp_approval_sheet.csv"], "ok");
  assert.deepEqual(extracted.foundSafeFiles, ["output/mvp/keyword_mvp_approval_sheet.csv"]);
});

test("detail artifact ZIP import supports nested GitHub artifact folders", () => {
  const extracted = extractExpectedArtifactFiles(
    "detail_page_engine",
    zip({
      "detail-page-engine-output/detailpage_final.html": "<main>Draft</main>",
      "detail-page-engine-output/detailpage_render_report.json": "{}",
      "detail-page-engine-output/multi_source_summary.json": "{}",
    }),
  );
  assert.equal(extracted.files["detailpage_final.html"], "<main>Draft</main>");
  assert.deepEqual(extracted.missingFiles, []);
});

test("duplicate allowed basenames fail safely", () => {
  assert.throws(
    () =>
      extractExpectedArtifactFiles(
        "keyword_engine",
        zip({
          "keyword_mvp_approval_sheet.csv": "one",
          "output/keyword_mvp_approval_sheet.csv": "two",
        }),
      ),
    /동일한 산출물 파일이 여러 위치/,
  );
});

test("data descriptor ZIP imports successfully without old manual parser error", () => {
  assert.doesNotThrow(() => {
    const extracted = extractExpectedArtifactFiles(
      "keyword_engine",
      zip(
        {
          "output/mvp/keyword_mvp_approval_sheet.csv": "goods_key,title\nBATH001,Towel",
          "output/mvp/keyword_mvp_manual_candidates.csv": "goods_key,title\nBATH002,Mat",
          "output/mvp/keyword_mvp_summary.md": "# Summary",
        },
        { dataDescriptor: true },
      ),
    );
    assert.equal(extracted.files["keyword_mvp_summary.md"], "# Summary");
    assert.deepEqual(extracted.missingFiles, []);
  });
});

test("unreadable zip returns clearer Korean ZIP parser error", () => {
  assert.throws(
    () => extractExpectedArtifactFiles("keyword_engine", new Uint8Array([1, 2, 3])),
    /GitHub Actions 산출물 ZIP을 읽지 못했습니다/,
  );
});

test("timezone and Korean review UX source requirements are present", async () => {
  const runner = await readFile(
    new URL(
      "../src/components/engine-runners/EngineRunnerConsole.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(runner, /formatBrowserLocalDateTime/);
  assert.match(runner, /브라우저 시간대 기준/);
  assert.match(runner, /가져올 결과물이 준비되었습니다/);
  assert.match(
    runner,
    /이전 실패 이력은 결과물 가져오기에 영향을 주지 않습니다/,
  );
  const review = await readFile(
    new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(review, /키워드 검토\/승인/);
  assert.match(review, /산출물 검토 안전 상태/);
  assert.match(review, /자동 적용 후보/);
  assert.match(review, /키워드 결과물을 불러왔습니다/);
  assert.match(review, /전체 행 수/);
  assert.match(review, /자동 적용 후보/);
  assert.match(review, /가져온 파일에 검토할 행이 없습니다/);
  const registry = await readFile(
    new URL("../src/lib/moduleRegistry.ts", import.meta.url),
    "utf8",
  );
  assert.match(registry, /키워드 결과 검토/);
  assert.match(
    registry,
    /보통은 키워드 엔진 실행기에서 ‘결과 가져오기 및 검토 시작’을 눌러 이동합니다/,
  );
});
