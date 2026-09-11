import assert from "node:assert/strict";
import test from "node:test";
import {
  legacySeoCanonicalOptionGroupMismatch,
  legacySeoShoplingSyncConfirmed,
} from "../src/lib/legacySeoShoplingSyncState.ts";

test("current item-level synced marker confirms Shopling option state", () => {
  assert.equal(
    legacySeoShoplingSyncConfirmed({
      shoplingOptionSync: {
        source: "shopling_live_grouped_option_sync",
        status: "synced",
        selectionReason: "canonical_option_exact_group",
      },
    }),
    true,
  );
});

test("canonical mismatch stays fail-closed even when stale option metadata says live sync", () => {
  const item = {
    shoplingOptionSync: {
      source: "shopling_live_grouped_option_sync",
      status: "existing_preserved",
      selectionReason: "canonical_option_group_mismatch",
    },
    orderOptions: [
      {
        shoplingOptionSync: {
          source: "shopling_live_grouped_option_sync",
          status: "synced",
        },
      },
    ],
  };
  assert.equal(legacySeoCanonicalOptionGroupMismatch(item), true);
  assert.equal(legacySeoShoplingSyncConfirmed(item), false);
});

test("legacy rows without item-level marker may use unanimous option-level live evidence", () => {
  assert.equal(
    legacySeoShoplingSyncConfirmed({
      orderOptions: [
        { shoplingOptionSync: { source: "shopling_live_grouped_option_sync" } },
        { shoplingOptionSync: { source: "shopling_live_grouped_option_sync" } },
      ],
    }),
    true,
  );
});

test("legacy fallback rejects partial option-level evidence", () => {
  assert.equal(
    legacySeoShoplingSyncConfirmed({
      orderOptions: [
        { shoplingOptionSync: { source: "shopling_live_grouped_option_sync" } },
        { shoplingOptionSync: { source: "historical_snapshot" } },
      ],
    }),
    false,
  );
});
