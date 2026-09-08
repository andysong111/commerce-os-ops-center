import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("이전상품 Shopling 근거는 오래된 goods_key가 있어도 모델번호 재탐색한다", async () => {
  const source = await readFile(
    new URL("../src/lib/legacySeoShoplingEvidence.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /staleMappedModels/);
  assert.match(source, /!hasActiveManagedOption\(model, mapping, rowsByGoodsKey\)/);
  assert.match(source, /discoverGoodsKeysByModel\(config, staleMappedModels\)/);
  assert.match(source, /compatibleGoodsKeys\(model, mapping, rowsByGoodsKey\)/);
  assert.match(source, /rowMatchesModel/);
});
