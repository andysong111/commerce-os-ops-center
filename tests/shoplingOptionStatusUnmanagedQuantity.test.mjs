import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/lib/shopling/shoplingOptionStatus.ts", import.meta.url),
  "utf8",
);

test("option status sync omits quantity from writes and verifies it by API readback", () => {
  assert.doesNotMatch(
    source,
    /throw new Error\("SHOPLING_OPTION_QUANTITY_INVALID"\)/,
  );
  const modifyBuilder = source.slice(
    source.indexOf("function buildModifyXml"),
    source.indexOf("function parseModifyResponse"),
  );
  assert.doesNotMatch(modifyBuilder, /optQty/);
  assert.match(source, /const delays = \[0, 400, 1_200\]/);
  assert.match(source, /last\.optionQuantity === expectedQuantity/);
  assert.match(source, /SHOPLING_OPTION_READBACK_QTY_MISMATCH/);
});
