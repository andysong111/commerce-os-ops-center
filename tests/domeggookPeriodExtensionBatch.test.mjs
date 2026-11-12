import assert from "node:assert/strict";
import test from "node:test";
import {
  runDomeggookAccountsSequentially,
  summarizeDomeggookBulkRun,
} from "../src/lib/domeggookPeriodExtensionBatch.ts";

const accounts = ["everysale999", "andy8010", "buzz1237", "andy80101"].map((accountId, index) => ({
  accountId,
  scheduleTime: `00:${String(10 + index * 5).padStart(2, "0")}`,
  extensionDays: 90,
  liveExecution: true,
  enabled: true,
  debugPort: 9600 + index,
  updatedAt: null,
}));

test("bulk immediate execution is sequential and one failed account does not block the rest", async () => {
  const calls = [];
  const results = await runDomeggookAccountsSequentially(accounts, async (account) => {
    calls.push(account.accountId);
    if (account.accountId === "everysale999") throw new Error("fixture failure");
  });

  assert.deepEqual(calls, accounts.map((account) => account.accountId));
  assert.deepEqual(summarizeDomeggookBulkRun(results), {
    total: 4,
    succeeded: ["andy8010", "buzz1237", "andy80101"],
    failed: ["everysale999"],
  });
});
