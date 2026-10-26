import assert from "node:assert/strict";
import test from "node:test";

import { productMasterSalesPlanFingerprint } from "../src/lib/productMasterSalesPlanFingerprint.ts";

test("candidate reconciliation reproduces the identity-versioned production sales plan fingerprint", () => {
  const request = {
    planningContentFingerprint:
      "sha256:03d4f63b712587e55f4922a2dee5b8496cd1908d115c643de6256c9962a099d1",
    identityResolverVersion: "option-self-code-v2",
    analysisAsOf: "2026-10-26T19:30:43.217Z",
  };
  const eventFingerprint =
    "sha256:04245c94ff2ccccb89c6cf6f80ce58f3565b0e40188312e84c33d964c9140272";

  assert.equal(
    productMasterSalesPlanFingerprint(request, eventFingerprint),
    "sha256:2ad97982fb690c7de0d69c617935d80b46d791f26c2739d0cc12551477f8f30b",
  );
});

test("sales plan fingerprint changes when the identity resolver contract changes", () => {
  const base = {
    planningContentFingerprint: `sha256:${"a".repeat(64)}`,
    identityResolverVersion: "option-self-code-v2",
    analysisAsOf: "2026-10-26T19:30:43.217Z",
  };
  const eventFingerprint = `sha256:${"b".repeat(64)}`;

  assert.notEqual(
    productMasterSalesPlanFingerprint(base, eventFingerprint),
    productMasterSalesPlanFingerprint(
      { ...base, identityResolverVersion: "legacy-unversioned" },
      eventFingerprint,
    ),
  );
});
