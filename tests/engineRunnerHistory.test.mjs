import assert from "node:assert/strict";
import test from "node:test";

import { addEngineRunnerHistoryItem, ENGINE_RUNNER_HISTORY_STORAGE_KEY, readEngineRunnerHistory } from "../src/lib/engineRunnerHistory.ts";

function installLocalStorage() {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
      clear: () => store.clear(),
    },
    dispatchEvent: () => true,
  };
  globalThis.crypto = { randomUUID: () => `id-${store.size}-${Date.now()}` };
  return store;
}

test("adds dispatch and artifact history items newest first", () => {
  installLocalStorage();
  addEngineRunnerHistoryItem({ kind: "keyword_engine", type: "dispatch_requested", title: "키워드 엔진 실행 요청", summary: "상품번호 123 기준으로 키워드 엔진 실행을 요청했습니다.", input: { goodsKey: "123" }, github: { repo: "owner/repo", workflowFile: "runner.yml", actionsUrl: "https://github.com/actions" }, status: "requested" });
  addEngineRunnerHistoryItem({ kind: "keyword_engine", type: "artifact_imported", title: "키워드 결과물 가져오기 완료", summary: "키워드 엔진 결과물을 검토/승인 큐로 가져왔습니다.", input: {}, github: { runId: 1, artifactId: 2, artifactName: "keyword-engine-mvp-output" }, reviewRoute: "/keyword-review-queue", status: "imported" });
  const items = readEngineRunnerHistory();
  assert.equal(items.length, 2);
  assert.equal(items[0].type, "artifact_imported");
  assert.equal(items[1].type, "dispatch_requested");
  assert.equal(items[0].safety.notAppliedToShopling, true);
});

test("keeps max 100 history items", () => {
  installLocalStorage();
  for (let index = 0; index < 105; index += 1) {
    addEngineRunnerHistoryItem({ kind: "detail_page_engine", type: "dispatch_requested", title: `상세페이지 엔진 실행 요청 ${index}`, summary: "1688 링크 기준으로 상세페이지 엔진 실행을 요청했습니다.", input: { sourceLink: `https://example.com/${index}` }, status: "requested" });
  }
  assert.equal(readEngineRunnerHistory().length, 100);
  assert.equal(readEngineRunnerHistory()[0].title, "상세페이지 엔진 실행 요청 104");
});

test("token/header fields and artifact contents are never stored", () => {
  const store = installLocalStorage();
  addEngineRunnerHistoryItem({ kind: "keyword_engine", type: "artifact_imported", title: "키워드 결과물 가져오기 완료", summary: "키워드 엔진 결과물을 검토/승인 큐로 가져왔습니다.", input: {}, github: { artifactId: 1 }, status: "imported", token: "secret", headers: { Authorization: "Bearer secret" }, files: { "result.csv": "huge,csv" }, html: "<main>payload</main>", payload: "full artifact" });
  const raw = store.get(ENGINE_RUNNER_HISTORY_STORAGE_KEY);
  assert.doesNotMatch(raw, /secret|Authorization|huge,csv|payload|<main>/);
});
