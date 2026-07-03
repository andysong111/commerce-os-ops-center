import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";

const page = fs.readFileSync("src/app/sourcing-engine/quick-save/page.tsx", "utf8");

test("quick save route contains save workflow", () => {
  assert.match(page, /Sourcing Quick Save/);
  assert.match(page, /Save card/);
  assert.match(page, /SOURCING_CARD_STORAGE_KEY/);
});
