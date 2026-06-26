import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = async () => ({
  card: await readFile(new URL("../src/components/OperationStatusCard.tsx", import.meta.url), "utf8"),
  page: await readFile(new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url), "utf8"),
  runner: await readFile(new URL("../src/lib/keywordShoplingApplyRunner.ts", import.meta.url), "utf8"),
  route: await readFile(new URL("../src/app/api/keyword-shopling-apply/actions-result/route.ts", import.meta.url), "utf8"),
});

test("OperationStatusCard exposes required Korean status strings", async () => {
  const { card } = await files();
  for (const text of ["작업 실행 중", "GitHub Actions 실행 중", "결과 파일 생성 대기", "성공", "실패", "로그 확인 필요"]) assert.match(card, new RegExp(text));
});

test("keyword review apply section includes bounded auto polling and action links", async () => {
  const { page } = await files();
  assert.match(page, /APPLY_POLL_INTERVAL_MS\s*=\s*5000/);
  assert.match(page, /MAX_APPLY_POLLS\s*=\s*18/);
  assert.match(page, /pollAfterDispatch/);
  assert.match(page, /마지막 확인/);
  assert.match(page, /GitHub Actions 열기/);
});

test("keyword apply API result shape includes phase and clearer missing-artifact messages", async () => {
  const { runner, route } = await files();
  assert.match(runner + route, /phase/);
  assert.match(runner, /completed_no_artifact/);
  assert.match(runner, /GitHub Actions는 종료되었지만 결과 artifact가 없습니다/);
  assert.match(runner, /request_id 매칭 전입니다/);
});

test("keyword apply observability keeps security boundaries", async () => {
  const combined = Object.values(await files()).join("\n");
  assert.doesNotMatch(combined, /child_process|shell:?\s*true|PowerShell|powershell/i);
  assert.doesNotMatch(combined, /ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+/);
  assert.doesNotMatch(combined, /SHOPLING_(?:PASSWORD|SECRET|TOKEN)\s*=\s*["'][^"']+/i);
  assert.doesNotMatch(combined, /https?:\/\/[^\s"']*shopling/i);
  assert.doesNotMatch(combined, /localStorage\.setItem\([^)]*(token|secret|password|credential)/i);
});


test("keyword apply UI has friendly non-failure polling messages and stale clearing", async () => {
  const { page } = await files();
  for (const text of [
    "실행 중입니다. 결과 가져오기를 반복해서 누르지 않아도 자동으로 확인합니다.",
    "이 상태는 실패가 아닙니다. 잠시 후 다시 확인합니다.",
    "자동 확인 중...",
    "자동 확인 시간이 끝났습니다.",
    "최종 실패는 GitHub Actions가 종료된 뒤에만 표시됩니다.",
    "실제 반영 요청을 보냈습니다. GitHub Actions가 시작되는 중입니다.",
  ]) assert.match(page, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(page, /setResult\(null\)/);
  assert.match(page, /disabled=\{dryRunMeta\.isPolling\}/);
  assert.match(page, /disabled=\{realMeta\.isPolling\}/);
});

test("keyword apply state mapping distinguishes pending from final failure", async () => {
  const { page } = await files();
  for (const text of [
    'if (result?.status === "pending")',
    'if (phase === "queued") return "queued"',
    'if (phase === "running") return "running"',
    'if (phase === "waiting_artifact" || phase === "unknown") return "waiting_artifact"',
    'runStatus === "completed" && runConclusion === "failure"',
    'phase === "completed_no_artifact"',
    '["failed", "partial_failure", "blocked"].includes(summaryStatus)',
  ]) assert.match(page, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("keyword apply runner keeps request matching pending until run or final artifact exists", async () => {
  const { runner } = await files();
  assert.match(runner, /아직 이 요청 ID와 매칭되는 GitHub Actions 실행을 찾지 못했습니다/);
  assert.match(runner, /run.status === "queued"/);
  assert.match(runner, /run.status === "in_progress"/);
  assert.match(runner, /artifactFailed/);
});
