import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runner = await readFile("src/components/local-ops/DetailPageLocalRunner.tsx", "utf8");
const status = await readFile("src/components/local-ops/LocalBridgeStatus.tsx", "utf8");
const sidebar = await readFile("src/components/Sidebar.tsx", "utf8");
const registry = await readFile("src/lib/moduleRegistry.ts", "utf8");

test("LocalBridgeStatus renders custom protocol bridge controls", () => {
  assert.match(status, /연결 안 됨/);
  assert.match(status, /승준컴 로컬 브릿지 실행 필요/);
  assert.match(status, /승준컴 브릿지 실행/);
  assert.match(status, /seungjun-ops-bridge:\/\/start/);
  assert.match(status, /seungjun-ops-bridge:\/\/stop/);
  assert.match(status, /연결 다시 확인/);
  assert.match(status, /\$\{currentBaseUrl\}\/health/);
  assert.match(status, /설치 안내 보기/);
  assert.match(status, /최초 1회 product-detail-page-auto에서 프로토콜 설치가 필요합니다/);
  assert.match(status, /Invoke-RestMethod http:\/\/127\.0\.0\.1:8765\/health/);
  assert.match(status, /브릿지가 꺼져 있습니다. ‘승준컴 브릿지 실행’을 누른 뒤 3~5초 후 연결 다시 확인을 눌러주세요/);
  assert.match(status, /브릿지 실행 요청을 보냈습니다. 브라우저 확인창이 뜨면 허용하세요/);
  assert.match(status, /3000/);
  assert.match(status, /6000/);
});

test("source-link runner only exposes the 1688 link field", () => {
  assert.match(runner, /\/runs\/source-link/);
  assert.match(runner, /1688 상품 링크/);
  assert.match(runner, /1688 상품 링크만 넣고 실행하면 승준컴 로컬 브릿지가 상세페이지를 생성합니다/);
  assert.doesNotMatch(runner, /상품코드/);
  assert.doesNotMatch(runner, /보조 링크/);
  assert.doesNotMatch(runner, /옵션\/색상 메모/);
  assert.doesNotMatch(runner, /기획 메모/);
});

test("image-upload runner only exposes the image upload field", () => {
  assert.match(runner, /상세페이지 이미지/);
  assert.match(runner, /상세페이지 이미지만 업로드하면 로컬 브릿지가 이미지 기반 상세페이지를 생성합니다/);
  assert.match(runner, /type="file"/);
  assert.doesNotMatch(runner, /상품명/);
  assert.doesNotMatch(runner, /카테고리 힌트/);
  assert.doesNotMatch(runner, /옵션\/색상 정보/);
});

test("image-upload page sends multipart form-data to /runs/upload-images", () => {
  assert.match(runner, /\/runs\/upload-images/);
  assert.match(runner, /new FormData/);
  assert.match(runner, /body: mode === "source-link" \? JSON\.stringify\(sourceLinkPayload\) : form/);
  assert.match(runner, /headers: mode === "source-link" \? \{ "Content-Type": "application\/json" \} : undefined/);
});

test("submit logic adds bridge-compatible hidden defaults", () => {
  assert.match(runner, /product_code: buildSourceLinkProductCode\(sourceLink\)/);
  assert.match(runner, /source_links: ""/);
  assert.match(runner, /option_info: ""/);
  assert.match(runner, /planning_point: ""/);
  assert.match(runner, /target: ""/);
  assert.match(runner, /form\.set\("product_code", `IMG-local-\$\{localTimestamp\(\)\}`\)/);
  assert.match(runner, /form\.set\("product_name", ""\)/);
  assert.match(runner, /form\.set\("category_hint", ""\)/);
  assert.match(runner, /form\.set\("option_info", ""\)/);
  assert.match(runner, /form\.set\("planning_point", ""\)/);
  assert.match(runner, /form\.set\("target", ""\)/);
  assert.match(runner, /offerId \? `DP-\$\{offerId\}` : `DP-local-\$\{localTimestamp\(\)\}`/);
});

test("result panel disables copy buttons when production_ready=false", () => {
  assert.match(runner, /production_ready && result\.full_image_ready && result\.shopling_html/);
  assert.match(runner, /disabled=\{!canCopy\}/);
  assert.match(runner, /이미지 수집 또는 최종 JPG 생성이 완료되지 않아 샵플링 HTML을 복사할 수 없습니다/);
});

test("nested run payloads are normalized before result panel copy gating", () => {
  assert.match(runner, /export function normalizeRunResult\(payload: RunResult\): RunResult/);
  assert.match(runner, /payload\?\.result && typeof payload\.result === "object" && !Array\.isArray\(payload\.result\)/);
  assert.match(runner, /\.\.\.nested/);
  assert.match(runner, /run_id: payload\.run_id \?\? nested\.run_id/);
  assert.match(runner, /status: payload\.status \?\? nested\.status/);
  assert.match(runner, /outer_status: payload\.status/);
  assert.match(runner, /const json = normalizeRunResult\(\(await response\.json\(\)\) as RunResult\)/);
});

test("success polling fetches and unwraps the final result endpoint", () => {
  assert.match(runner, /async function fetchRunResult\(baseUrl: string, runId: string\)/);
  assert.match(runner, /\/runs\/\$\{encodeURIComponent\(runId\)\}\/result/);
  assert.match(runner, /return normalizeRunResult\(\(await response\.json\(\)\) as RunResult\)/);
  assert.match(runner, /if \(json\.status === "success"\) \{/);
  assert.match(runner, /const finalResult = await fetchRunResult\(baseUrl, runId\)/);
  assert.match(runner, /onResult\(finalResult\)/);
});

test("manual result refresh button reloads run status and final result", () => {
  assert.match(runner, /결과 다시 불러오기/);
  assert.match(runner, /async function refreshRunResult\(baseUrl: string, runId: string\)/);
  assert.match(runner, /fetch\(`\$\{baseUrl\}\/runs\/\$\{encodeURIComponent\(runId\)\}`\)/);
  assert.match(runner, /if \(statusResult\.status === "success"\) return fetchRunResult\(baseUrl, runId\)/);
  assert.match(runner, /onRefresh=\{refreshResult\}/);
});

test("result panel enables copy buttons when nested result has production_ready=true and full_image_ready=true", () => {
  assert.match(runner, /const canCopy = Boolean\(result\?\.production_ready && result\.full_image_ready && result\.shopling_html\)/);
  assert.match(runner, /navigator\.clipboard\.writeText\(result\.shopling_html/);
  assert.match(runner, /navigator\.clipboard\.writeText\(imageUrl\)/);
});

test("result panel renders visible run metadata", () => {
  assert.match(runner, /<Row k="run_id" v=\{result\.run_id\}/);
  assert.match(runner, /<Row k="status" v=\{result\.status\}/);
  assert.match(runner, /<Row k="step" v=\{result\.step\}/);
  assert.match(runner, /<Row k="message" v=\{result\.message\}/);
});


test("failed local runs fetch and render expandable diagnostics", () => {
  assert.match(runner, /fetchRunLogs/);
  assert.match(runner, /\/runs\/\$\{encodeURIComponent\(runId\)\}\/logs/);
  assert.match(runner, /실패 로그 펼쳐보기/);
  assert.match(runner, /error_text/);
  assert.match(runner, /log_text/);
  assert.match(runner, /diagnostic_files/);
  assert.match(runner, /전체 진단 복사/);
  assert.match(runner, /에러 로그 복사/);
  assert.match(runner, /상태 JSON 복사/);
  assert.match(runner, /image_hosting_map\.json/);
  assert.match(runner, /no_usable_source_images/);
  assert.match(runner, /1688_auth_or_traffic_challenge/);
});

test("dashboard/sidebar contains local-only and image-upload labels", () => {
  assert.match(sidebar, /승준컴 로컬 전용/);
  assert.match(registry, /상세페이지 엔진 \(이미지 업로드\)/);
  assert.match(registry, /detail-page-image-upload-runner/);
});

test("local runner pages do not call GitHub Actions dispatch", () => {
  assert.doesNotMatch(runner, /api\/engine-runners\/dispatch/);
  assert.doesNotMatch(runner, /githubActionsDispatch/);
});
