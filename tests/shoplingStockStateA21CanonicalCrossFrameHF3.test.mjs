import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("v0.5.5 HF3 reuses canonical A21 option-send semantics across accessible Shopling frames", async () => {
  const [route, readme, manifest] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8"),
    readFile("public/shopling-stock-state-sync/README.txt", "utf8"),
    readFile("public/shopling-stock-state-sync/manifest.json", "utf8"),
  ]);

  assert.match(route, /a21CanonicalListSource: "shopling-a21-price-option-resend\/content-a21\.js:clickModifySend"/);
  assert.match(route, /a21AccessibleDocumentsV056/);
  assert.match(route, /add\(document, "self"\)/);
  assert.match(route, /visit\(window\.top, "top"\)/);
  assert.match(route, /img\[alt\],img\[title\]/);
  assert.match(route, /button\.click\(\)/);
  assert.match(route, /CURRENT_FRAME_THEN_ALL_ACCESSIBLE_SHOPLING_FRAMES/);
  assert.match(route, /EXACT_GOODS_KEY_ALL_ROWS_UP_TO_200/);
  assert.match(route, /CANONICAL_PRICE_CORE_MODIFY_TP_GOODS_STOCK_AND_TRSMT_ENV_MODY_OPT_1/);
  assert.match(readme, /v0\.5\.5 HF3/);
  assert.match(manifest, /v0\.5\.5 HF3/);
});
