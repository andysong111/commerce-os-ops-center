import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("purchase draft saves current edits before opening the local 1688 cart automation", async () => {
  const source = await readFile("src/components/china-order-manager/InternalChinaPurchaseDraftWorkspaceV2.tsx", "utf8");
  assert.match(source, /persistDraft\(\{ quiet: true \}\)/);
  assert.match(source, /127\.0\.0\.1:43121\/\?draftId=/);
  assert.match(source, /1688 장바구니 준비/);
  assert.match(source, /주문 제출과 결제는 자동 실행하지 않습니다/);
});
