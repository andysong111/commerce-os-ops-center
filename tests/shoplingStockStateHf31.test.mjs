import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("HF31 applies all-date guards to both A6 lookup and A21 transmission", async () => {
  const source = await readFile(
    "src/app/api/shopling-stock-state-sync/download-hf31/route.ts",
    "utf8",
  );

  assert.match(source, /getHf30Download/);
  assert.match(source, /const BASE_VERSION = "0\.5\.8"/);
  assert.match(source, /const VERSION = "0\.5\.9"/);
  assert.match(source, /HF31_A6_A21_ALL_DATE_EXACT_BCODE_LOOKUP/);
  assert.match(source, /function clearA6DateScopeHF31\(\)/);
  assert.match(source, /input\[name="s_dt"\]/);
  assert.match(source, /input\[name="e_dt"\]/);
  assert.match(source, /input\.value = ""/);
  assert.match(source, /const dateScope = clearA6DateScopeHF31\(\)/);
  assert.match(source, /searchExact\("옵션자체관리코드", job\.barcode\)/);
  assert.match(source, /A6_RESULT_PAGE_INCOMPLETE/);
  assert.match(source, /goodsKeySource: "A6_LIVE_OPTION_BARCODE"/);
  assert.match(source, /const A21_WORKER = "content-a21-canonical-v014\.js"/);
  assert.match(source, /function enableAllDateSearch\(\)/);
  assert.match(source, /all_srch_no_term_btn/);
  assert.match(source, /checkbox\.checked === true/);
  assert.match(source, /new Function\(a21Worker\)/);
  assert.match(source, /a21DateScope: "ALL_DATES"/);
  assert.match(source, /a21AllDateGuardRestored: true/);
  assert.match(source, /liveShoplingA6AllDateVerified: false/);
  assert.match(source, /liveShoplingA21AllDateVerified: false/);
  assert.match(source, /liveShoplingVerificationRequired: true/);
});

