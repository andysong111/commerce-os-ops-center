import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import {
  compactKeywordElonKey,
  uniqueKeywordElonCanonical,
} from "../src/lib/keywordEngineElonLabV2.ts";
import {
  keywordElonScoreUnavailable,
  planKeywordElonSelectionRecovery,
} from "../src/lib/keywordEngineElonSelectionRecovery.ts";

const source = await readFile(new URL("../src/lib/keywordEngineElonLabV2Merge.ts", import.meta.url), "utf8");
const withoutImport = source.replace(/import[\s\S]*?from\s+"@\/lib\/keywordEngineElonLabV2";\n/, "");
globalThis.__keywordMergePrimitives = { compactKeywordElonKey, uniqueKeywordElonCanonical };
const js = stripTypeScriptTypes(
  "const {compactKeywordElonKey,uniqueKeywordElonCanonical}=globalThis.__keywordMergePrimitives;\n" + withoutImport,
  { mode: "strip" },
);
const { mergeKeywordElonCandidates } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
delete globalThis.__keywordMergePrimitives;

const row = (rationale, overrides = {}) => ({
  keyword: "패딩장갑", searchKey: "패딩장갑", rationale,
  safetyPass: false, titleEligible: false, relevance: 0,
  qualityScore: 0, totalSearch: 100, sourceTags: [], ...overrides,
});

test("successful zero-score rejection replaces timeout, not vice versa", () => {
  const timeout = row("AI 점수화 실패 · AI_SCORE_TIMEOUT", { sourceTags: ["primary_seed"] });
  const rejection = row("관련성 0 · 카테고리 0", { sourceTags: ["searchad_related"] });
  for (const [base, added] of [[timeout, rejection], [rejection, timeout]]) {
    const [result] = mergeKeywordElonCandidates([base], [added]);
    assert.equal(result.rationale, rejection.rationale);
    assert.equal(result.safetyPass, false);
    assert.equal(result.qualityScore, 0);
    assert.deepEqual(new Set(result.sourceTags), new Set(["primary_seed", "searchad_related"]));
    assert.equal(keywordElonScoreUnavailable(result), false);
  }
});

test("recovered rejection cannot re-enter next paid recovery plan", () => {
  const candidates = mergeKeywordElonCandidates(
    [row("AI 점수화 실패 · AI_SCORE_TIMEOUT")],
    [row("관련성 0 · 카테고리 0")],
  );
  const plan = planKeywordElonSelectionRecovery({
    identity: { coreProduct: "패딩장갑", primarySeeds: ["패딩장갑"], identityAnchor: "패딩장갑" },
    discovery: { candidates: ["패딩장갑"], sourceTagsByKeyword: {}, searchAdStats: [] },
    candidates,
  });
  assert.equal(plan, null);
});

test("successful scores still use normal quality ranking and canonical keys", () => {
  const low = row("관련성 85", { keyword: "패딩 장갑", searchKey: "패딩 장갑", safetyPass: true, qualityScore: 65 });
  const high = row("관련성 95", { safetyPass: true, qualityScore: 80 });
  const [result] = mergeKeywordElonCandidates([low], [high]);
  assert.equal(result.keyword, "패딩장갑");
  assert.equal(result.qualityScore, 80);
});

test("missing response is not promoted to a real evaluation", () => {
  const [result] = mergeKeywordElonCandidates(
    [row("AI 점수 응답 누락")], [row("AI 점수화 실패 · AI_SCORE_TIMEOUT")],
  );
  assert.equal(keywordElonScoreUnavailable(result), true);
  assert.equal(result.safetyPass, false);
});
