import assert from "node:assert/strict";
import test from "node:test";

import { verifyOpenAIKey } from "../scripts/verify-openai-production-keys.mjs";

const quietLogger = { log() {}, warn() {}, error() {} };

test("production key verification retries a transient timeout and then succeeds", async () => {
  let calls = 0;
  let sleeps = 0;
  const result = await verifyOpenAIKey({
    name: "TEST_KEY",
    key: "test-key",
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new DOMException("timed out", "TimeoutError");
      return { ok: true, status: 200 };
    },
    sleepImpl: async () => {
      sleeps += 1;
    },
    logger: quietLogger,
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
  assert.equal(sleeps, 1);
});

test("production key verification does not retry an authentication rejection", async () => {
  let calls = 0;
  const result = await verifyOpenAIKey({
    name: "TEST_KEY",
    key: "bad-key",
    fetchImpl: async () => {
      calls += 1;
      return { ok: false, status: 401 };
    },
    sleepImpl: async () => {
      throw new Error("sleep should not run");
    },
    logger: quietLogger,
  });

  assert.deepEqual(result, { ok: false, reason: "HTTP 401" });
  assert.equal(calls, 1);
});

test("production key verification retries a transient server failure", async () => {
  let calls = 0;
  const result = await verifyOpenAIKey({
    name: "TEST_KEY",
    key: "test-key",
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? { ok: false, status: 503 } : { ok: true, status: 200 };
    },
    sleepImpl: async () => {},
    logger: quietLogger,
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
});
