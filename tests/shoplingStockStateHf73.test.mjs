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
import { buildHf72TransmissionGroups } from "../src/lib/shoplingStockHf72Patch.ts";
import {
  patchHf73A21ContentSource,
  patchHf73A21MainSource,
} from "../src/lib/shoplingStockHf73Patch.ts";

async function hf73Workers() {
  const [contentBase, mainBase] = await Promise.all([
    readFile("public/shopling-stock-state-sync/price-core-content-a21-v025.js", "utf8"),
    readFile("public/shopling-stock-state-sync/price-core-main-a21-v025.js", "utf8"),
  ]);
  return {
    content: patchHf73A21ContentSource(
      patchHf71A21ContentSource(
        patchHf70A21ContentSource(patchHf69A21ContentSource(contentBase)),
      ),
    ),
    main: patchHf73A21MainSource(
      patchHf71A21MainSource(
        patchHf70A21MainSource(patchHf69A21MainSource(mainBase)),
      ),
    ),
  };
}

test("HF73 selects the exact Shopling option radios in MAIN world and reads back both checked states", async () => {
  const { content, main } = await hf73Workers();
  assert.match(content, /mainSubmit\("OPTION", "PREPARE"\)/);
  assert.match(content, /V029_MAIN_OPTION_PREPARE_NOT_VISIBLE/);
  assert.match(content, /JSON\.stringify\(\{ nonce, mode, phase \}\)/);
  assert.match(main, /HTMLInputElement\.prototype\.click\.call\(target\)/);
  assert.match(main, /Object\.getOwnPropertyDescriptor\([\s\S]*"checked"/);
  assert.match(main, /modeChecked: exact\.mode\.checked === true/);
  assert.match(main, /fieldChecked: exact\.field\.checked === true/);

  class FakeInput {
    constructor({ type = "radio", disabled = false } = {}) {
      this.type = type;
      this.disabled = disabled;
      this.checked = false;
      this.events = [];
    }
    click() {
      this.checked = true;
    }
    dispatchEvent(event) {
      this.events.push(event.type);
      return true;
    }
  }
  class FakeEvent {
    constructor(type) {
      this.type = type;
    }
  }
  const sandbox = { __COMMERCE_OS_EXPOSE_A21_V029_TEST_HOOKS__: true };
  new Function("globalThis", "HTMLInputElement", "Event", "document", main)(
    sandbox,
    FakeInput,
    FakeEvent,
    {},
  );
  const hooks = sandbox.__commerceOsA21V029TestHooks;
  assert.ok(hooks);

  const target = new FakeInput();
  assert.equal(hooks.nativeCheckExactRadio(target), true);
  assert.equal(target.checked, true);
  assert.deepEqual(target.events, ["input", "change"]);

  const disabled = new FakeInput({ disabled: true });
  assert.equal(hooks.nativeCheckExactRadio(disabled), false);
  assert.equal(disabled.checked, false);
  assert.deepEqual(disabled.events, []);

  const wrongType = new FakeInput({ type: "checkbox" });
  assert.equal(hooks.nativeCheckExactRadio(wrongType), false);
  assert.equal(wrongType.checked, false);
  new Function(content);
  new Function(main);
});

test("HF73 fails closed on ambiguous radios and preserves one grouped submit for fourteen compatible goods keys", async () => {
  const { content, main } = await hf73Workers();
  assert.match(main, /modeCandidates\.length !== 1 \|\| fieldCandidates\.length !== 1/);
  assert.match(main, /v029_option_target_ambiguity/);
  assert.match(content, /mode === field/);

  const groups = buildHf72TransmissionGroups(
    Array.from({ length: 14 }, (_, index) => ({
      goodsKey: String(111000 + index),
      transmissionKind: "OPTION_SEND",
      effectiveProductKind: "OPTION",
      optionCount: 2,
    })),
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].chunks.length, 1);
  assert.equal(groups[0].chunks[0].length, 14);
});

test("HF73 download and operator gate expose v0.6.36 while preserving the HF72 grouped background", async () => {
  const [route, page, planner, background, workflow] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf73/route.ts", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile("public/shopling-stock-state-sync/background-v092.js", "utf8"),
    readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
  ]);
  assert.match(route, /const BASE_VERSION = "0\.6\.35"/);
  assert.match(route, /const VERSION = "0\.6\.36"/);
  assert.match(route, /GROUPED_BY_TRANSMISSION_KIND_UP_TO_200/);
  assert.match(route, /ONE_PER_COMPATIBLE_GOODS_KEY_GROUP/);
  assert.match(route, /EXACT_SEMANTIC_RADIOS_SELECTED_AND_READ_BACK_IN_SHOPLING_MAIN_WORLD/);
  assert.match(page, /download-hf73/);
  assert.match(page, /v0\.6\.36 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 36\]/);
  assert.match(background, /GROUP_BY_TRANSMISSION_KIND_UP_TO_200/);
  assert.match(workflow, /shoplingStockStateHf73\.test\.mjs/);
  new Function(background);
});
