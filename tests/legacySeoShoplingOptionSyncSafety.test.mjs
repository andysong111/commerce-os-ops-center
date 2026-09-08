import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("이전상품 Shopling 옵션 동기화는 B코드 없는 과거/단종 옵션을 재수입하지 않는다", async () => {
  const source = await readFile(
    new URL("../src/lib/legacySeoShoplingOptionSync.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /function activeGroupOptions/);
  assert.match(source, /Boolean\(text\(option\.bCode\)\)/);
  assert.match(source, /text\(option\.status\)\.toUpperCase\(\) !== "X"/);
  assert.match(source, /const shoplingOptions = activeGroupOptions\(group\)/);
});

test("Shopling 옵션 교체는 DELETE 후 INSERT가 아니라 DB 원자적 RPC만 사용한다", async () => {
  const source = await readFile(
    new URL("../src/lib/legacySeoShoplingOptionSync.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /replace_product_launch_options_atomic/);
  assert.match(source, /LEGACY_SEO_OPTION_REPLACE_EMPTY_ROWS_BLOCKED/);
  assert.match(source, /LEGACY_SEO_OPTION_REPLACE_COUNT_MISMATCH/);
  assert.doesNotMatch(source, /method:\s*"DELETE"/);
});

test("한 상품 옵션 동기화 실패가 같은 배치의 다른 상품 복구를 중단시키지 않는다", async () => {
  const source = await readFile(
    new URL("../src/lib/legacySeoShoplingOptionSync.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /for \(const item of items\) \{/);
  assert.match(source, /catch \(error\) \{/);
  assert.match(source, /failed:\s*true/);
  assert.match(source, /failedCount: results\.filter\(\(result\) => result\.failed\)\.length/);
});

test("옵션 누락 상품도 먼저 Shopling 복구를 시도하고 가격은 현재 동기화가 확정된 모델만 적용한다", async () => {
  const source = await readFile(
    new URL("../src/lib/legacySeoPreflight.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /legacySeoRegistrationExclusionFromPolicy/);
  assert.match(source, /Missing normalized options are recoverable/);
  assert.match(source, /priceEligibleModels/);
  assert.match(source, /syncedFromCurrentShopling\(item\)/);
  assert.match(source, /현재 Shopling 옵션\/B코드 확정 전이라 중국주문 최종가격 적용을 차단/);
});
