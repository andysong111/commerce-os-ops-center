import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const consoleSource = readFileSync("src/components/engine-runners/EngineRunnerConsole.tsx", "utf8");
const historyPageSource = readFileSync("src/app/engine-runner-history/page.tsx", "utf8");
const dashboardSource = readFileSync("src/lib/moduleRegistry.ts", "utf8");

test("keyword and detail runner record dispatch and artifact import history", () => {
  assert.match(consoleSource, /addEngineRunnerHistoryItem/);
  assert.match(consoleSource, /키워드 엔진 실행 요청/);
  assert.match(consoleSource, /상세페이지 엔진 실행 요청/);
  assert.match(consoleSource, /키워드 결과물 가져오기 완료/);
  assert.match(consoleSource, /상세페이지 결과물 가져오기 완료/);
});

test("history page renders title empty state filters and local-only safety notes", () => {
  assert.match(historyPageSource, /엔진 실행 이력/);
  assert.match(historyPageSource, /아직 엔진 실행 이력이 없습니다/);
  assert.match(historyPageSource, /전체/);
  assert.match(historyPageSource, /키워드 엔진/);
  assert.match(historyPageSource, /상세페이지 엔진/);
  assert.match(historyPageSource, /샵플링 자동 반영이나 상세페이지 자동 게시 이력이 아닙니다/);
  assert.match(historyPageSource, /현재 이력은 이 브라우저에 저장됩니다/);
});

test("dashboard renders engine runner history card and route", () => {
  assert.match(dashboardSource, /엔진 실행 이력/);
  assert.match(dashboardSource, /키워드\/상세페이지 엔진 실행 요청과 결과물 가져오기 이력을 확인합니다/);
  assert.match(dashboardSource, /\/engine-runner-history/);
  assert.match(dashboardSource, /이력 보기/);
});

test("safety source does not add child_process or execution APIs", () => {
  const combined = historyPageSource + readFileSync("src/lib/engineRunnerHistory.ts", "utf8");
  assert.doesNotMatch(combined, /child_process|powershell|PowerShell\.exe|Shopling API 실행|auto-publish|auto-apply/i);
});
