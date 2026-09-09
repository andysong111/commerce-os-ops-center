import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("확정가격이 전 옵션 동일하고 이름 불일치가 정확히 1개일 때만 잔여 옵션 가격을 자동 연결한다", async () => {
  const source = await readFile(
    new URL("../src/lib/legacySeoCanonicalPrice.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /function uniqueUniformResidualCanonicalRow/);
  assert.match(source, /activeRows\.length !== options\.length/);
  assert.match(source, /!sameCanonicalValues\(activeRows\)/);
  assert.match(source, /new Set\(optionKeys\)\.size !== optionKeys\.length/);
  assert.match(source, /new Set\(canonicalKeys\)\.size !== canonicalKeys\.length/);
  assert.match(
    source,
    /unmatchedOptionKeys\.length !== 1 \|\| unmatchedCanonicalRows\.length !== 1/,
  );
  assert.match(source, /uniform_single_residual_name_mismatch/);
  assert.match(source, /currentSaleOption/);
  assert.match(source, /canonicalSaleOption/);
});
