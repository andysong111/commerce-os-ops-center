import assert from "node:assert/strict";
import vm from "node:vm";
import test from "node:test";
import { buildA19KeywordAuditV0346 } from "../src/lib/shoplingMarketA19KeywordAuditV0346.ts";
import {
  buildA19LoginLoopHotfixV0347,
  shouldRunShoplingMarketAutoAgentV0347,
} from "../src/lib/shoplingMarketA19LoginLoopV0347.ts";
import { SHOPLING_MARKET_AUTO_AGENT_V0330 } from "../src/lib/shoplingMarketAutoExtensionV0330.ts";

function v0345Fixture() {
  return {
    "manifest.json": JSON.stringify({
      version: "0.3.45",
      permissions: ["storage", "tabs"],
      content_scripts: [
        {
          matches: ["*://*.shopling.co.kr/*"],
          js: ["shopling-market-auto-agent.mjs"],
          all_frames: false,
          run_at: "document_idle",
        },
      ],
      action: { default_title: "v0.3.45" },
    }),
    "background-root.mjs": String.raw`
      const MARKET_AUTO_BG_REPORT = "commerce-os-shopling-market-auto-bg-report-v0330";
      const storage = {};
      async function marketAutoStorageGet(keys) {
        return Object.fromEntries(keys.map((key) => [key, storage[key]]));
      }
      async function marketAutoStorageSet(values) { Object.assign(storage, values); return values; }
      async function marketAutoAgentId() { return "agent"; }
      async function requestJson() { return {}; }
      function text(value) { return String(value || ""); }
      async function marketAutoRequest(action, token) {
        const agentId = await marketAutoAgentId();
        return requestJson("endpoint", {
          action,
          token,
          agentId,
        });
      }
      async function marketAutoTick() {
        const rows = [];
        for (const row of rows) {
          const response = {};
          if (response.ready === true && Array.isArray(response.jobIds) && response.jobIds.length) {
            return { ...response, token: row.token, ok: true };
          }
        }
        return { ok: true, ready: false };
      }
      async function marketAutoHeartbeat(token) { return token; }
      async function marketAutoReport(token) {
        const response = await marketAutoRequest("agent_report", token);
        return response;
      }
      function handler(message, sendResponse) {
        if (message.type === MARKET_AUTO_BG_REPORT) {
          const token = text(message.token);
          marketAutoReport(token).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
          return true;
        }
      }
    `.replace(/^ {6}/gm, ""),
    "shopling-market-auto-agent.mjs": SHOPLING_MARKET_AUTO_AGENT_V0330,
  };
}

function buildPackage() {
  return buildA19LoginLoopHotfixV0347(
    buildA19KeywordAuditV0346(v0345Fixture()),
  );
}

test("v0.3.47 never starts the market auto-agent on login or A19 audit pages", () => {
  assert.equal(
    shouldRunShoplingMarketAutoAgentV0347(
      "kt.shopling.co.kr",
      "/prodlinkage/goods_mallReg_list.phtml",
    ),
    true,
  );
  assert.equal(
    shouldRunShoplingMarketAutoAgentV0347(
      "kt.shopling.co.kr",
      "/login.phtml",
    ),
    false,
  );
  assert.equal(
    shouldRunShoplingMarketAutoAgentV0347(
      "kt.shopling.co.kr",
      "/prodlinkage/goods_mallReg_failList.phtml",
    ),
    false,
  );
  assert.equal(
    shouldRunShoplingMarketAutoAgentV0347(
      "other.shopling.co.kr",
      "/prodlinkage/goods_mallReg_list.phtml",
    ),
    false,
  );

  const output = buildPackage();
  const manifest = JSON.parse(output["manifest.json"]);
  const autoAgents = manifest.content_scripts.filter((entry) =>
    entry.js?.includes("shopling-market-auto-agent.mjs"),
  );
  assert.equal(manifest.version, "0.3.47");
  assert.deepEqual(autoAgents, [
    {
      matches: [
        "https://a.shopling.co.kr/*",
        "https://kt.shopling.co.kr/*",
      ],
      js: ["shopling-market-auto-agent.mjs"],
      all_frames: false,
      run_at: "document_idle",
    },
  ]);
  assert.match(output["shopling-market-auto-agent.mjs"], /login\.phtml/);
  assert.match(output["shopling-market-auto-agent.mjs"], /goods_mallReg_failList\.phtml/);
});

test("v0.3.47 shares one A19 audit across concurrent Shopling tabs and retains only one login tab", async () => {
  const output = buildPackage();
  const background = `${output["background-root.mjs"]}\n;globalThis.__v0347Test = { marketAutoAuditA19 };`;
  let createCount = 0;
  let removeCount = 0;
  let loginPresent = false;
  const extensionStorage = {};
  const chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys, callback) {
          callback(Object.fromEntries(keys.map((key) => [key, extensionStorage[key]])));
        },
        set(values, callback) {
          Object.assign(extensionStorage, values);
          callback();
        },
        remove(keys, callback) {
          for (const key of keys) delete extensionStorage[key];
          callback();
        },
      },
    },
    tabs: {
      query(_query, callback) {
        callback(loginPresent ? [{ id: 71, status: "complete", url: "https://kt.shopling.co.kr/login.phtml" }] : []);
      },
      create(_options, callback) {
        createCount += 1;
        loginPresent = true;
        callback({ id: 71 });
      },
      get(_tabId, callback) {
        callback({ id: 71, status: "complete", url: "https://kt.shopling.co.kr/login.phtml" });
      },
      remove(_tabId, callback) {
        removeCount += 1;
        callback();
      },
    },
  };
  const context = {
    chrome,
    console,
    crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000047" },
    URL,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(background, context);
  const audit = context.__v0347Test.marketAutoAuditA19;

  const concurrent = await Promise.allSettled([
    audit("token-a", "orchestration-a"),
    audit("token-a", "orchestration-a"),
  ]);
  assert.deepEqual(
    concurrent.map((result) => result.status),
    ["rejected", "rejected"],
  );
  assert.ok(
    concurrent.every(
      (result) =>
        result.status === "rejected" &&
        result.reason?.message === "a19_login_required",
    ),
  );
  assert.equal(createCount, 1);
  assert.equal(removeCount, 0);

  await assert.rejects(
    audit("token-a", "orchestration-a"),
    /a19_login_required/,
  );
  assert.equal(createCount, 1, "an existing login tab must block every new A19 tab");
  assert.equal(removeCount, 0, "the single login tab stays available for the owner to sign in");
});

test("v0.3.47 preserves the v0.3.46 receipt-only audit and never adds retransmission", () => {
  const output = buildPackage();
  for (const name of [
    "background-root.mjs",
    "shopling-market-auto-agent.mjs",
    "shopling-a19-keyword-auditor.mjs",
  ]) {
    new Function(output[name]);
  }
  assert.match(output["background-root.mjs"], /marketAutoA19AuditInFlight/);
  assert.match(output["background-root.mjs"], /a19_login_required/);
  assert.match(output["background-root.mjs"], /a19AuditReceipt/);
  assert.doesNotMatch(
    output["shopling-a19-keyword-auditor.mjs"],
    /상품 재전송|일괄삭제|선택상태변경/,
  );
});
