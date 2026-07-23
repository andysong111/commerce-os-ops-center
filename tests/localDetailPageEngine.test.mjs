import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runner = await readFile("src/components/local-ops/DetailPageLocalRunner.tsx", "utf8");
const status = await readFile("src/components/local-ops/LocalBridgeStatus.tsx", "utf8");
const sidebar = await readFile("src/components/Sidebar.tsx", "utf8");
const registry = await readFile("src/lib/moduleRegistry.ts", "utf8");

test("LocalBridgeStatus renders disconnected state and start command", () => {
  assert.match(status, /연결 안 됨/);
  assert.match(status, /승준컴 로컬 브릿지 실행 필요/);
  assert.match(status, /python tools\/run_local_ops_bridge\.py --host 127\.0\.0\.1 --port 8765/);
});

test("source-link page posts to /runs/source-link", () => {
  assert.match(runner, /\/runs\/source-link/);
  assert.match(runner, /1688 상품 링크/);
});

test("image-upload page sends multipart form-data to /runs/upload-images", () => {
  assert.match(runner, /\/runs\/upload-images/);
  assert.match(runner, /new FormData/);
  assert.match(runner, /type=\"file\"/);
  assert.match(runner, /headers: mode === "source-link" \? \{ "Content-Type": "application\/json" \} : undefined/);
});

test("result panel disables copy buttons when production_ready=false", () => {
  assert.match(runner, /production_ready && result\.full_image_ready && result\.shopling_html/);
  assert.match(runner, /disabled=\{!canCopy\}/);
  assert.match(runner, /이미지 수집 또는 최종 JPG 생성이 완료되지 않아 샵플링 HTML을 복사할 수 없습니다/);
});

test("result panel enables copy buttons when production_ready=true and full_image_ready=true", () => {
  assert.match(runner, /navigator\.clipboard\.writeText\(result\.shopling_html/);
  assert.match(runner, /navigator\.clipboard\.writeText\(imageUrl\)/);
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
