import assert from "node:assert/strict";
import vm from "node:vm";
import test from "node:test";
import { SHOPLING_MARKET_AUTO_AGENT_V0330 } from "../src/lib/shoplingMarketAutoExtensionV0330.ts";
import { buildStaleQueueRecoveryV0348 } from "../src/lib/shoplingMarketStaleQueueRecoveryV0348.ts";

const QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0330";
const INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0330";
const JOB_ID = "11111111-1111-4111-8111-111111111111";

function v0347Fixture() {
  const agent = SHOPLING_MARKET_AUTO_AGENT_V0330.replace(
    "  if (window.top !== window) return;",
    [
      "  if (window.top !== window) return;",
      '  if (!["a.shopling.co.kr","kt.shopling.co.kr"].includes(location.hostname) || ["/login.phtml","/prodlinkage/goods_mallReg_failList.phtml"].includes(location.pathname)) return;',
    ].join("\n"),
  );
  return {
    "manifest.json": JSON.stringify({
      version: "0.3.47",
      content_scripts: [
        {
          matches: [
            "https://a.shopling.co.kr/*",
            "https://kt.shopling.co.kr/*",
          ],
          js: ["shopling-market-auto-agent.mjs"],
          all_frames: false,
          run_at: "document_idle",
        },
      ],
      action: { default_title: "v0.3.47" },
    }),
    "shopling-market-auto-agent.mjs": agent,
  };
}

function buildPackage() {
  return buildStaleQueueRecoveryV0348(v0347Fixture());
}

async function flushMicrotasks() {
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function startAgent(initialStorage) {
  const output = buildPackage();
  const storage = structuredClone(initialStorage);
  const sentMessages = [];
  const storageWrites = [];
  let intervalCallback = null;
  const chrome = {
    runtime: {
      lastError: null,
      sendMessage(payload, callback) {
        sentMessages.push(structuredClone(payload));
        if (payload.type === "commerce-os-shopling-parallel-worker-context") {
          callback({ worker: false });
          return;
        }
        callback({ ok: true, ready: false });
      },
    },
    storage: {
      local: {
        get(keys, callback) {
          const requested = Array.isArray(keys) ? keys : [keys];
          callback(
            Object.fromEntries(requested.map((key) => [key, storage[key]])),
          );
        },
        set(values, callback) {
          storageWrites.push(structuredClone(values));
          Object.assign(storage, values);
          callback();
        },
        remove(keys, callback) {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete storage[key];
          }
          callback();
        },
      },
    },
  };
  const window = {};
  window.top = window;
  vm.runInNewContext(output["shopling-market-auto-agent.mjs"], {
    chrome,
    location: {
      hostname: "kt.shopling.co.kr",
      pathname: "/",
    },
    setInterval(callback) {
      intervalCallback = callback;
      return 1;
    },
    setTimeout() {
      return 2;
    },
    clearInterval() {},
    clearTimeout() {},
    window,
  });
  assert.equal(typeof intervalCallback, "function");
  return {
    output,
    storage,
    storageWrites,
    sentMessages,
    async tick() {
      intervalCallback();
      await flushMicrotasks();
    },
  };
}

test("v0.3.48 preserves a running queue and restores only its A18 resume intent", async () => {
  const queue = {
    version: "0.3.43",
    status: "running",
    jobIds: [JOB_ID],
    startedAt: 1700000000000,
    updatedAt: 1700000001000,
  };
  const runtime = startAgent({ [QUEUE_KEY]: queue });

  await runtime.tick();

  assert.deepEqual(runtime.storage[QUEUE_KEY], queue);
  assert.deepEqual(Array.from(runtime.storage[INTENT_KEY].jobIds), [JOB_ID]);
  assert.equal(runtime.storage[INTENT_KEY].status, "pending");
  assert.equal(runtime.storage[INTENT_KEY].resumeRunningQueue, true);
  assert.equal(
    runtime.storage[INTENT_KEY].reason,
    "resume_existing_running_queue",
  );
  assert.equal(
    runtime.sentMessages.some(
      (row) => row.type === "commerce-os-shopling-market-auto-bg-tick-v0330",
    ),
    false,
    "the next orchestration must not be claimed before the old queue is reconciled",
  );
  assert.doesNotMatch(
    runtime.output["shopling-market-auto-agent.mjs"],
    /remove\s*\(\s*QUEUE_KEY/,
  );
});

test("v0.3.48 does not overwrite a recent pending intent while recovering a queue", async () => {
  const pending = {
    version: "0.3.47",
    status: "pending",
    jobIds: ["22222222-2222-4222-8222-222222222222"],
    createdAt: Date.now(),
  };
  const runtime = startAgent({
    [QUEUE_KEY]: {
      status: "running",
      jobIds: [JOB_ID],
      startedAt: 1700000000000,
    },
    [INTENT_KEY]: pending,
  });

  await runtime.tick();

  assert.deepEqual(runtime.storage[INTENT_KEY], pending);
  assert.equal(runtime.storageWrites.length, 0);
});

test("v0.3.48 fails closed when a running queue has no valid job identity", async () => {
  const runtime = startAgent({
    [QUEUE_KEY]: {
      status: "running",
      jobIds: ["not-a-job-id"],
      startedAt: 1700000000000,
    },
  });

  await runtime.tick();

  assert.equal(runtime.storage[INTENT_KEY], undefined);
  assert.equal(runtime.storageWrites.length, 0);
  assert.equal(
    runtime.sentMessages.some(
      (row) => row.type === "commerce-os-shopling-market-auto-bg-tick-v0330",
    ),
    false,
  );
});

test("v0.3.48 keeps normal claiming enabled after the prior queue is terminal", async () => {
  const runtime = startAgent({
    [QUEUE_KEY]: {
      status: "completed_with_exceptions",
      jobIds: [JOB_ID],
      startedAt: 1700000000000,
    },
  });

  await runtime.tick();

  assert.equal(runtime.storage[INTENT_KEY], undefined);
  assert.equal(
    runtime.sentMessages.some(
      (row) => row.type === "commerce-os-shopling-market-auto-bg-tick-v0330",
    ),
    true,
  );
});

test("v0.3.48 package retains the v0.3.47 login-loop guards", () => {
  const output = buildPackage();
  const manifest = JSON.parse(output["manifest.json"]);
  assert.equal(manifest.version, "0.3.48");
  assert.match(output["shopling-market-auto-agent.mjs"], /login\.phtml/);
  assert.match(
    output["shopling-market-auto-agent.mjs"],
    /goods_mallReg_failList\.phtml/,
  );
  assert.match(
    output["shopling-market-auto-agent.mjs"],
    /ensureRunningQueueResumeIntentV0348/,
  );
});
