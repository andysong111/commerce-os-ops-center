import assert from "node:assert/strict";
import test from "node:test";

import {
  legacyManualSourcingDraftStorageKeys,
  manualSourcingDraftStorageKey,
} from "../src/lib/manualSourcingDraftStorage.ts";

const pathname = "/purchase-cycle-preflight";
const formId = "manual-new-product-form";

function storageWithKeys(keys) {
  return {
    length: keys.length,
    key: (index) => keys[index] ?? null,
  };
}

test("manual sourcing draft key stays stable when the calculation form appears or the day changes", () => {
  assert.equal(
    manualSourcingDraftStorageKey(pathname, "?date=2026-10-06", formId),
    manualSourcingDraftStorageKey(pathname, "?date=2026-10-10&check=1", formId),
  );
  assert.match(
    manualSourcingDraftStorageKey(pathname, "?date=2026-10-10", formId),
    /month-2026-10$/,
  );
});

test("replacement draft identity takes precedence over volatile preview query fields", () => {
  const first = manualSourcingDraftStorageKey(pathname, "?replace=fast-purchase-draft%3Aabc&date=2026-10-06", formId);
  const second = manualSourcingDraftStorageKey(pathname, "?replace=fast-purchase-draft%3Aabc&date=2026-10-10&early=1", formId);
  assert.equal(first, second);
  assert.match(first, /fast-purchase-draft:abc$/);
});

test("legacy recovery finds both standalone and calculated-form storage slots", () => {
  const matching = [
    "commerce-os.manual-sourcing-intake.v1:/purchase-cycle-preflight:manual-new-product-form:standalone:fast-purchase-draft:abc",
    "commerce-os.manual-sourcing-intake.v1:/purchase-cycle-preflight:manual-new-product-form:new-product-configuration-form:fast-purchase-draft:abc",
  ];
  const keys = legacyManualSourcingDraftStorageKeys(
    storageWithKeys([
      ...matching,
      "commerce-os.manual-sourcing-intake.v1:/purchase-cycle-preflight:manual-new-product-form:standalone:fast-purchase-draft:other",
      "commerce-os.manual-sourcing-intake.v1:/sourcing-center:manual:standalone:default",
    ]),
    pathname,
    "?replace=fast-purchase-draft%3Aabc&date=2026-10-10",
    formId,
  );
  assert.deepEqual(keys, matching);
});

test("legacy daily slots from the same purchase month can be recovered", () => {
  const matching = [
    "commerce-os.manual-sourcing-intake.v1:/purchase-cycle-preflight:manual-new-product-form:standalone:2026-10-06",
    "commerce-os.manual-sourcing-intake.v1:/purchase-cycle-preflight:manual-new-product-form:new-product-configuration-form:2026-10-08",
  ];
  const keys = legacyManualSourcingDraftStorageKeys(
    storageWithKeys([...matching, matching[0].replace("2026-10-06", "2026-09-30")]),
    pathname,
    "?date=2026-10-10",
    formId,
  );
  assert.deepEqual(keys, matching);
});
