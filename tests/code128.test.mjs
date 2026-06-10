import assert from "node:assert/strict";
import test from "node:test";
import {
  createCode128Layout,
  encodeCode128B,
} from "../src/lib/code128.ts";

test("encodes only the location code as CODE128-B with the expected checksum", () => {
  assert.deepEqual(
    encodeCode128B("BAA1-1"),
    [104, 34, 33, 33, 17, 13, 17, 23, 106],
  );
});

test("creates printable black-bar positions with CODE128 quiet zones", () => {
  const layout = createCode128Layout("BAA1-1");

  assert.equal(layout.width, 121);
  assert.equal(layout.bars[0].x, 10);
  assert.ok(layout.bars.every((bar) => bar.width > 0));
});

test("rejects empty and unsupported non-ASCII location codes", () => {
  assert.throws(() => encodeCode128B(""), /ASCII 32~126/);
  assert.throws(() => encodeCode128B("위치-1"), /ASCII 32~126/);
});
