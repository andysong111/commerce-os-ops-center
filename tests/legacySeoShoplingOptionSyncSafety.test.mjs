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
