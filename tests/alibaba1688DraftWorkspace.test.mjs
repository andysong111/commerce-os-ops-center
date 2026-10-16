import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("purchase draft saves current edits before opening the local 1688 cart automation", async () => {
  const source = await readFile("src/components/china-order-manager/InternalChinaPurchaseDraftWorkspaceV2.tsx", "utf8");
  assert.match(source, /persistDraft\(\{ quiet: true, syncMetadata: false \}\)/);
  assert.match(source, /if \(options\.syncMetadata !== false\) \{/);
  assert.match(source, /127\.0\.0\.1:43121\/\?draftId=/);
  assert.match(source, /purchaseEvidenceSignature/);
  assert.match(source, /cartRefreshDeadlineRef/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /실제 위안단가와 중국 내 운임을 자동 반영했습니다/);
  assert.match(source, /1688 장바구니 준비/);
  assert.match(source, /주문 제출과 결제는 자동 실행하지 않습니다/);
});

test("purchase draft visibly marks rows excluded from 1688 cart preparation", async () => {
  const source = await readFile("src/components/china-order-manager/InternalChinaPurchaseDraftWorkspaceV2.tsx", "utf8");
  assert.match(source, /\[1688 준비 제외\]/);
  assert.match(source, /1688 장바구니 준비 제외 \{number\.format\(preparationExcludedLines\.length\)\} SKU/);
  assert.match(source, /line\.note\.includes\(PREPARATION_NOTE_PREFIX\)/);
});
