import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("이전상품 Shopling 복구는 공식 상품이미지 img_0~31 전체를 조회한다", async () => {
  const source = await readFile(
    new URL("../src/lib/legacySeoShoplingEvidence.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /const SHOPLING_PRODUCT_IMAGE_FIELDS = Array\.from\(/);
  assert.match(source, /\{ length: 32 \}/);
  assert.match(source, /\(_, index\) => `img_\$\{index\}`/);
  assert.match(source, /\.\.\.SHOPLING_PRODUCT_IMAGE_FIELDS/);
  assert.match(
    source,
    /\.\.\.SHOPLING_PRODUCT_IMAGE_FIELDS\.map\(\(field\) => first\[field\]\)/,
  );
});

test("Shopling 옵션 이미지 optImgUrl도 버리지 않고 이전상품 이미지 근거에 포함한다", async () => {
  const readClient = await readFile(
    new URL("../src/lib/shopling/shoplingReadClient.ts", import.meta.url),
    "utf8",
  );
  const evidence = await readFile(
    new URL("../src/lib/legacySeoShoplingEvidence.ts", import.meta.url),
    "utf8",
  );

  assert.match(readClient, /const optionImageUrls = splitCsv\(options\?\.optImgUrl\);/);
  assert.match(readClient, /optionImageUrls\.length/);
  assert.match(readClient, /optImgUrl: optionImageUrls\[index\] \?\? ""/);
  assert.match(evidence, /\.\.\.rows\.map\(\(row\) => row\.optImgUrl\)/);
});
