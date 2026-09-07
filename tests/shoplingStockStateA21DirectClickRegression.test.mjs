import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("A21 list click regression guard matches previously proven direct click semantics", async () => {
  const [route, proven] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8"),
    readFile("public/shopling-a21-price-option-resend/content-a21.js", "utf8"),
  ]);
  assert.match(proven, /상품\\s\*수정전송/);
  assert.match(proven, /candidates\[0\]\.click\(\)/);
  assert.match(route, /상품\\\\s\*수정전송/);
  assert.match(route, /button\.click\(\)/);
  assert.match(route, /PROVEN_A21_LIST_DIRECT_CLICK/);
});
