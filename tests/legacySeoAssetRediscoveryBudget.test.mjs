import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("방금 Shopling 전체 재탐색에서 옵션/B코드 0개가 확정된 상품은 자산 단계에서 같은 탐색을 반복하지 않는다", async () => {
  const source = await readFile(
    new URL("../src/lib/legacySeoShoplingAssetRecovery.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /const RECENT_NO_OPTION_PROOF_MS = 5 \* 60 \* 1000;/);
  assert.match(source, /function recentlyConfirmedNoManagedOptions/);
  assert.match(source, /text\(sync\.status\) !== "existing_preserved"/);
  assert.match(source, /Number\(sync\.optionCount\) !== 0/);
  assert.match(source, /Number\(sync\.bCodeCount\) !== 0/);
  assert.match(source, /\.filter\(\(item\) => !recentlyConfirmedNoManagedOptions\(item\)\)/);
  assert.match(source, /models\.length\s*\? await loadLegacySeoShoplingEvidence\(models\)/);
});
