import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const backgroundPath = "public/shopling-stock-state-sync/background-v050.js";

test("Shopling A21 completion stays authoritative while marketplace failures are advisory", async () => {
  const source = await readFile(backgroundPath, "utf8");

  assert.match(source, /const legacyHandleEvidenceV051 = handleEvidence/);
  assert.match(source, /if \(evidence\.processing\) return legacyHandleEvidenceV051/);
  assert.match(source, /Boolean\(evidence\.optionComplete\)/);
  assert.match(source, /Boolean\(evidence\.productComplete\)/);
  assert.match(source, /evidence\.readyState !== "complete"/);
  assert.match(source, /marketplaceFailuresIgnored/);
  assert.match(source, /SHOPLING_A21_COMPLETION_AUTHORITATIVE_MARKETPLACE_FAILURES_ADVISORY/);
  assert.match(source, /return continueNextGoodsKey\(active, sender, normalizedEvidence\)/);
});

test("marketplace failures are still preserved in evidence instead of discarded", async () => {
  const source = await readFile(backgroundPath, "utf8");

  assert.match(source, /marketplaceFailureCount/);
  assert.match(source, /marketplaceFailureText/);
  assert.match(source, /result: normalizedEvidence/);
  assert.match(source, /마켓별 실패 .*건은 기록만 하고 성공 판정/);
});
