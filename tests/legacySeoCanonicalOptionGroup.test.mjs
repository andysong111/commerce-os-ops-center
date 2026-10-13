import assert from "node:assert/strict";
import test from "node:test";
import {
  legacySeoCanonicalOptionSignature,
  legacySeoOptionGroupMatchesCanonical,
} from "../src/lib/legacySeoCanonicalOptionGroup.ts";

test("canonical option signature normalizes spacing and punctuation", () => {
  assert.equal(
    legacySeoCanonicalOptionSignature([" 레드 ", "색상: 블루"]),
    "레드|색상블루",
  );
});

test("exact red/blue group matches canonical red/blue regardless of order", () => {
  assert.equal(
    legacySeoOptionGroupMatchesCanonical(["블루", "레드"], ["레드", "블루"]),
    true,
  );
});

test("live exact options may use a safe subset of historical canonical rows", () => {
  assert.equal(
    legacySeoOptionGroupMatchesCanonical(
      ["옐로우 1P", "오렌지 1P"],
      ["옐로우", "옐로우 1P", "오렌지 1P"],
    ),
    true,
  );
});

test("single-option model may rename the Shopling display label", () => {
  assert.equal(
    legacySeoOptionGroupMatchesCanonical(["한 쌍"], ["단품"]),
    true,
  );
});

test("complete one-to-one prefix or suffix labels match safely", () => {
  assert.equal(
    legacySeoOptionGroupMatchesCanonical(
      ["색상레드", "색상블루"],
      ["레드", "블루"],
    ),
    true,
  );
});

test("newer 1+1 package options cannot masquerade as canonical red/blue options", () => {
  assert.equal(
    legacySeoOptionGroupMatchesCanonical(
      ["블루 1+1", "레드 1+1"],
      ["레드", "블루"],
    ),
    false,
  );
});

test("ordered size labels match the same Shopling dimensions one-to-one", () => {
  assert.equal(
    legacySeoOptionGroupMatchesCanonical(
      ["12.5x12.5x5", "17x12x6.5", "15x15x7"],
      ["1호12.5x12.5x5", "2호17x12x6.5", "3호15x15x7"],
    ),
    true,
  );
});

test("ordinal stripping cannot collapse two canonical options into one", () => {
  assert.equal(
    legacySeoOptionGroupMatchesCanonical(
      ["블루", "레드"],
      ["1호블루", "2호블루"],
    ),
    false,
  );
});

test("option count mismatch fails closed", () => {
  assert.equal(legacySeoOptionGroupMatchesCanonical(["단품"], ["레드", "블루"]), false);
});
