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
  assert.doesNotMatch(combined, /child_process|shell:\s*true|PowerShell|powershell/i);
  assert.doesNotMatch(combined, /ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+/);
  assert.doesNotMatch(combined, /SHOPLING_(?:PASSWORD|SECRET|TOKEN)\s*=\s*["'][^"']+/i);
  assert.doesNotMatch(combined, /https?:\/\/[^\s"']*shopling/i);
  assert.doesNotMatch(combined, /localStorage\.setItem\([^)]*(token|secret|password|credential)/i);
});
