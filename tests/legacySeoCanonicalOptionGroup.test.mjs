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

test("newer 1+1 package options cannot masquerade as canonical red/blue options", () => {
  assert.equal(
    legacySeoOptionGroupMatchesCanonical(
      ["블루 1+1", "레드 1+1"],
      ["레드", "블루"],
    ),
    false,
  );
});

test("option count mismatch fails closed", () => {
  assert.equal(legacySeoOptionGroupMatchesCanonical(["단품"], ["레드", "블루"]), false);
});
