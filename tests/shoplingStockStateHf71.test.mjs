import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  patchHf69A21ContentSource,
  patchHf69A21MainSource,
} from "../src/lib/shoplingStockHf69Patch.ts";
import {
  patchHf70A21ContentSource,
  patchHf70A21MainSource,
} from "../src/lib/shoplingStockHf70Patch.ts";
import {
  patchHf71A21ContentSource,
  patchHf71A21MainSource,
} from "../src/lib/shoplingStockHf71Patch.ts";

async function hf71Workers() {
  const [contentBase, mainBase] = await Promise.all([
    readFile("public/shopling-stock-state-sync/price-core-content-a21-v025.js", "utf8"),
    readFile("public/shopling-stock-state-sync/price-core-main-a21-v025.js", "utf8"),
  ]);
  return {
    content: patchHf71A21ContentSource(
      patchHf70A21ContentSource(patchHf69A21ContentSource(contentBase)),
    ),
    main: patchHf71A21MainSource(
      patchHf70A21MainSource(patchHf69A21MainSource(mainBase)),
    ),
  };
}

function fixture(overrides = {}) {
  const labels = ["일반내용수정", "상품판매상태송신", "옵션송신"];
  return labels.map((label, index) => ({
    index,
    id: `mode-${index}`,
    name: "sendMode",
    value: String(index),
    checked: false,
    disabled: false,
    visible: true,
    top: 100,
    left: 100 + index * 240,
    inlineTexts: [label],
    cellText: label,
    ...overrides[index],
  }));
}

test("HF71 regression: adjacent labels and the proven three-column layout select only the rightmost 옵션송신 radio", async () => {
  const { content, main } = await hf71Workers();
  const sandbox = { __COMMERCE_OS_EXPOSE_A21_V025_TEST_HOOKS__: true };
  new Function("globalThis", content)(sandbox);
  const hooks = sandbox.__commerceOsA21V025TestHooks;
  assert.ok(hooks);

  assert.equal(hooks.chooseOptionModeSnapshot(fixture()), 2);

  const nestedLegacyCells = fixture({
    0: { inlineTexts: [], cellText: "일반내용수정상품명판매가카테고리" },
    1: { inlineTexts: [], cellText: "상품판매상태송신판매중판매중지품절상품삭제" },
    2: { inlineTexts: [], cellText: "옵션송신옵션송신추가상품송신옵션+추가상품송신" },
  });
  assert.equal(hooks.chooseOptionModeSnapshot(nestedLegacyCells), 2);

  assert.equal(hooks.chooseOptionModeSnapshot(fixture().slice(0, 2)), -1);
  const ambiguousExactLabels = fixture({
    0: { inlineTexts: ["옵션송신"], cellText: "옵션송신" },
    2: { inlineTexts: ["옵션송신"], cellText: "옵션송신" },
  });
  assert.equal(hooks.chooseOptionModeSnapshot(ambiguousExactLabels), -1);
  const duplicateOutsideHeader = [
    ...fixture(),
    {
      ...fixture()[2],
      index: 3,
      top: 300,
      inlineTexts: ["옵션송신"],
    },
  ];
  assert.equal(hooks.chooseOptionModeSnapshot(duplicateOutsideHeader), -1);

  const diagnostics = hooks.safeOptionModeDiagnostics(
    Array.from({ length: 20 }, (_, index) => ({
      ...fixture()[index % 3],
      index,
      cellText: "가".repeat(500),
    })),
  );
  assert.equal(diagnostics.length, 12);
  assert.ok(diagnostics.every((row) => row.cellText.length <= 120));

  assert.match(content, /previousSibling/);
  assert.match(content, /topRow\.length !== 3/);
  assert.match(content, /라디오 진단=/);
  assert.match(main, /v028_option_semantic_guard_invalid/);
  assert.match(main, /exact\.length === 1 && exact\[0\]\.control === control/);
  new Function(content);
  new Function(main);
});

test("HF71 historical package stays reproducible while HF72 advances the live gate", async () => {
  const [route, page, planner, operator, background, workflow] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf71/route.ts", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile("src/components/china-order-manager/InventoryStockoutOperatorPanel.tsx", "utf8"),
    readFile("public/shopling-stock-state-sync/background-v091.js", "utf8"),
    readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
  ]);
  assert.match(route, /const VERSION = "0\.6\.34"/);
  assert.match(route, /EXACT_ADJACENT_LABEL_THEN_GUARDED_THREE_COLUMN_GEOMETRY/);
  assert.match(route, /SERIAL_ONE_AT_A_TIME/);
  assert.match(route, /marketplaceCompletionRequired: false/);
  assert.match(page, /download-hf74/);
  assert.match(page, /v0\.6\.37 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 37\]/);
  assert.doesNotMatch(operator, /v0\.6\.33/);
  assert.match(background, /importScripts\("background-v090\.js"\)/);
  assert.match(workflow, /shoplingStockStateHf71\.test\.mjs/);
  new Function(background);
});
