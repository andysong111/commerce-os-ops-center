import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/lib/shopling/shoplingOptionStatus.ts", import.meta.url),
  "utf8",
);

test("option status sync never invents quantity when Shopling optQty is unmanaged", () => {
  assert.doesNotMatch(
    source,
    /throw new Error\("SHOPLING_OPTION_QUANTITY_INVALID"\)/,
  );
  assert.match(source, /const quantityField = \/\^\\d\+\$\/\.test\(variant\.optionQuantity\)/);
  assert.match(source, /\.\.\.quantityField/);
  assert.match(source, /SHOPLING_OPTION_READBACK_QTY_MISMATCH/);
});
