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
  assert.match(source, /실제 위안단가·중국내 운임을 반영하고 발주금액을 다시 계산했습니다/);
  assert.match(source, /1688 장바구니 준비/);
  assert.match(source, /결제수단 선택 화면에서 멈추며 결제는 직접 진행합니다/);
  assert.match(source, /링크·옵션 등 일괄 저장/);
  assert.match(source, /최신 실제금액 불러오기/);
});

test("purchase draft visibly marks rows excluded from 1688 cart preparation", async () => {
  const source = await readFile("src/components/china-order-manager/InternalChinaPurchaseDraftWorkspaceV2.tsx", "utf8");
  assert.match(source, /1688 장바구니 준비 제외 \{number\.format\(preparationExcludedLines\.length\)\} SKU/);
  assert.match(source, /activePreparationNote\(line\)/);
  assert.match(source, /removeResolvedPreparationNote\(line\)/);
});

test("purchase draft keeps post-cart unit prices precise enough for exact line subtotals", async () => {
  const source = await readFile("src/components/china-order-manager/InternalChinaPurchaseDraftWorkspaceV2.tsx", "utf8");
  assert.match(source, /Math\.round\(decimal\(value\) \* 1_000_000\) \/ 1_000_000/);
  assert.match(source, /step="0\.000001"/);
});
