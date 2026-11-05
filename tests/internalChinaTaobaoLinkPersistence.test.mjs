import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("purchase metadata sync keeps the operator-entered Taobao product id", async () => {
  const workspace = await readFile(
    "src/components/china-order-manager/InternalChinaPurchaseDraftWorkspaceV2.tsx",
    "utf8",
  );
  assert.match(workspace, /body: JSON\.stringify\(payload\(\)\)/);
  assert.doesNotMatch(workspace, /body: JSON\.stringify\(payload\(nextDraft\)\)/);
  assert.match(workspace, /taobaoItemId/);
  assert.match(workspace, /타오바오 열기/);
});
