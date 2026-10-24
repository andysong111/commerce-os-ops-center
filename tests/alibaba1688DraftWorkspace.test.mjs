import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("purchase draft exposes separate 5-1 cost capture and 5-2 cart staging actions", async () => {
  const source = await readFile("src/components/china-order-manager/InternalChinaPurchaseDraftWorkspaceV2.tsx", "utf8");
  assert.match(source, /persistDraft\(\{ quiet: true, syncMetadata: false \}\)/);
  assert.match(source, /if \(options\.syncMetadata !== false\) \{/);
  assert.match(source, /127\.0\.0\.1:43121\/\?draftId=/);
  assert.match(source, /purchaseEvidenceSignature/);
  assert.match(source, /cartRefreshDeadlineRef/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /실제 위안단가와 중국 내 운임을 자동 반영했습니다/);
  assert.match(source, /5-1 원가·운임 기록/);
  assert.match(source, /5-2 장바구니 담기/);
  assert.match(source, /mode=\$\{mode\}/);
  assert.match(source, /"cost-capture" \| "cart-staging"/);
  assert.match(source, /주문 제출과 결제는 자동 실행하지 않습니다/);
  assert.doesNotMatch(source, /submitCheckoutOrder|paymentExecuted:\s*true/);
});
