import test from "node:test";
import assert from "node:assert/strict";

import {
  RELIABILITY_ADMIN_READ_HEADER,
  deriveReliabilityAdminReadToken,
  authorizeReliabilityAdminRead,
} from "../src/lib/reliability/reliabilityAdminReadAuth.ts";

const SECRET = "test-reliability-secret";

function requestWith(value) {
  return new Request("https://ops.example.test/api/integrations/reliability/admin-summary", {
    headers: value ? { [RELIABILITY_ADMIN_READ_HEADER]: value } : {},
  });
}

test("derived reliability admin token is deterministic and distinct from ingest secret", () => {
  const first = deriveReliabilityAdminReadToken(SECRET);
  const second = deriveReliabilityAdminReadToken(SECRET);
  assert.equal(first, second);
  assert.equal(first.length, 64);
  assert.notEqual(first, SECRET);
});

test("derived read token authorizes the read-only endpoint", () => {
  const token = deriveReliabilityAdminReadToken(SECRET);
  assert.deepEqual(authorizeReliabilityAdminRead(requestWith(token), SECRET), {
    ok: true,
  });
});

test("raw ingest secret and wrong tokens are rejected", () => {
  assert.equal(authorizeReliabilityAdminRead(requestWith(SECRET), SECRET).ok, false);
  assert.equal(
    authorizeReliabilityAdminRead(requestWith("0".repeat(64)), SECRET).ok,
    false,
  );
  assert.equal(authorizeReliabilityAdminRead(requestWith(null), SECRET).ok, false);
});

test("missing server configuration fails closed", () => {
  const result = authorizeReliabilityAdminRead(
    requestWith(deriveReliabilityAdminReadToken(SECRET)),
    "",
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 503);
});
