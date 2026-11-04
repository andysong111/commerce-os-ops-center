import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadContentHooks() {
  const source = await readFile(
    "public/shopling-stock-state-sync/price-core-content-a21-v025.js",
    "utf8",
  );
  const sandbox = { __COMMERCE_OS_EXPOSE_A21_V025_TEST_HOOKS__: true };
  new Function("globalThis", source)(sandbox);
  assert.ok(sandbox.__commerceOsA21V025TestHooks);
  return { source, hooks: sandbox.__commerceOsA21V025TestHooks };
}

test("HF68 reproduces the current A21 popup and separates the two option-send controls", async () => {
  const { hooks } = await loadContentHooks();

  // 2026-11-05 production fixture: the top mode owns its radio in the same
  // cell, while the lower option-only row has a separate exact '선택' cell.
  assert.equal(hooks.isExactOptionModeCell("옵션송신", 1), true);
  assert.equal(hooks.isExactOptionModeCell("옵션송신", 0), false);
  assert.equal(hooks.isExactOptionModeCell(" 옵션 송신 ", 1), true);

  assert.equal(
    hooks.classifyOptionFieldRow(["옵션송신", "선택"], "옵션송신 선택"),
    "OPTION_ONLY",
  );
  assert.equal(
    hooks.classifyOptionFieldRow(["추가상품송신", "선택"], "추가상품송신 선택"),
    "FORBIDDEN",
  );
  assert.equal(
    hooks.classifyOptionFieldRow(
      ["옵션+추가상품송신", "선택"],
      "옵션+추가상품송신 선택",
    ),
    "FORBIDDEN",
  );
});

test("HF68 fails closed on ambiguous labels and verifies the exact marked controls again in MAIN world", async () => {
  const [{ source }, main] = await Promise.all([
    loadContentHooks(),
    readFile(
      "public/shopling-stock-state-sync/price-core-main-a21-v025.js",
      "utf8",
    ),
  ]);

  assert.match(source, /unique\.length === 1 \? unique\[0\] : null/);
  assert.match(source, /rows\.length === 1 \? rows\[0\]\.control : null/);
  assert.match(source, /forbiddenOptionChoices\(\)\.every\(\(choice\) => !choice\.checked\)/);
  assert.match(source, /verifyOptionContract\(\) \|\| verifySemanticOption\(\)/);
  assert.match(source, /locator: "FORM_CONTRACT"/);
  assert.match(source, /locator: "EXACT_VISIBLE_LABELS"/);

  assert.match(main, /semanticModeMatches\(mode\)/);
  assert.match(main, /semanticFieldMatches\(field\)/);
  assert.match(main, /forbiddenOptionSelected\(\)/);
  assert.match(main, /window\.goods_mallMdfy_submit_sp\(\)/);
});

test("HF68 remains an immutable historical package after HF69 becomes current", async () => {
  const [route, oldContent] = await Promise.all([
    readFile(
      "src/app/api/shopling-stock-state-sync/download-hf68/route.ts",
      "utf8",
    ),
    readFile(
      "public/shopling-stock-state-sync/price-core-content-a21-v024.js",
      "utf8",
    ),
  ]);

  assert.match(route, /getHf67Download/);
  assert.match(route, /const BASE_VERSION = "0\.6\.30"/);
  assert.match(route, /const VERSION = "0\.6\.31"/);
  assert.match(route, /price-core-content-a21-v025\.js/);
  assert.match(route, /content-a21-price-core-v051\.js/);
  assert.match(route, /main-a21-price-core-v051\.js/);
  assert.match(route, /CURRENT_A21_OPTION_CONTROLS_NO_LONGER_MATCHED/);
  assert.match(route, /liveShoplingVerificationRequired: true/);
  assert.match(oldContent, /const VERSION = "0\.2\.4"/);
  assert.doesNotMatch(oldContent, /EXACT_VISIBLE_LABELS/);
});
