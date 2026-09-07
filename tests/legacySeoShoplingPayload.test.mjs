import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("이전상품은 각 옵션을 개별 검증한 뒤 실제 B코드를 그대로 재조합한다", async () => {
  const source = await readFile(
    new URL("../src/lib/legacySeoShoplingPayload.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /buildProductLaunchShoplingPayload/);
  assert.match(source, /orderOptions: \[option\]/);
  assert.match(source, /barcode,/);
  assert.match(source, /validated\.map/);
  assert.match(source, /additionalAmountKrw/);
  assert.doesNotMatch(source, /barcode.*(?:index|suffix)/i);
});

test("이전상품 등록 경로만 공유 B코드 호환 빌더를 사용한다", async () => {
  const source = await readFile(
    new URL("../src/lib/legacySeoShoplingRegistration.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /buildLegacySeoShoplingPayload/);
  assert.doesNotMatch(source, /buildProductLaunchShoplingPayload\(item, state\.policy, requestId\)/);
});
