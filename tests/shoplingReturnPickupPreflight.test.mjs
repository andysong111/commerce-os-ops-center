import assert from "node:assert/strict";
import test from "node:test";
import { runReturnPickupPreflight } from "../local-agent/src/shopling-return-pickup-preflight.mjs";

const config = {
  shoplingOrigins: ["https://a.shopling.co.kr/"],
  cjLoisOrigins: ["https://loisparcelp.cjlogistics.com/"],
};

function targets(overrides = {}) {
  return {
    available: true,
    targets: [
      { id: "s", type: "page", url: "https://a.shopling.co.kr/main.phtml" },
      { id: "c", type: "page", url: "https://loisparcelp.cjlogistics.com/index.do" },
    ],
    ...overrides,
  };
}

test("return-pickup preflight is ready only when both authenticated pages are ready", async () => {
  const result = await runReturnPickupPreflight(config, {}, {
    listChromeTargets: async () => targets(),
    inspectShoplingTarget: async (_target, account) => account === "andy801",
    inspectCjTarget: async () => true,
  });
  assert.equal(result.readyForDryRun, true);
  assert.deepEqual(result.requiredUserActions, []);
  assert.equal(result.externalWritesAllowed, false);
});

test("return-pickup preflight accepts an authenticated CJ home that can auto-navigate", async () => {
  const result = await runReturnPickupPreflight(config, {}, {
    listChromeTargets: async () => targets(),
    inspectShoplingTarget: async () => true,
    inspectCjTarget: async () => ({
      reservationPageReady: false,
      authenticated: true,
      navigationReady: true,
    }),
  });
  assert.equal(result.cjReservationPageReady, false);
  assert.equal(result.cjAutoNavigationReady, true);
  assert.equal(result.readyForDryRun, true);
  assert.deepEqual(result.requiredUserActions, []);
});

test("return-pickup preflight blocks an unrecognized CJ page", async () => {
  const result = await runReturnPickupPreflight(config, {}, {
    listChromeTargets: async () => targets(),
    inspectShoplingTarget: async () => true,
    inspectCjTarget: async () => ({
      reservationPageReady: false,
      authenticated: false,
      navigationReady: false,
    }),
  });
  assert.equal(result.readyForDryRun, false);
  assert.deepEqual(result.requiredUserActions, [
    "LOGIN_CJ_LOIS_OR_OPEN_RESERVATION_NAVIGATION",
  ]);
});

test("return-pickup preflight reports the exact missing user actions", async () => {
  const result = await runReturnPickupPreflight(config, {}, {
    listChromeTargets: async () => targets({
      targets: [{ id: "s", type: "page", url: "https://a.shopling.co.kr/main.phtml" }],
    }),
    inspectShoplingTarget: async () => false,
    inspectCjTarget: async () => false,
  });
  assert.equal(result.readyForDryRun, false);
  assert.deepEqual(result.requiredUserActions, [
    "LOGIN_SHOPLING_AS_andy801",
    "OPEN_ONE_CJ_LOIS_TAB_IN_DEDICATED_CHROME",
  ]);
});

test("return-pickup preflight reports unavailable dedicated Chrome", async () => {
  const result = await runReturnPickupPreflight(config, {}, {
    listChromeTargets: async () => ({ available: false, targets: [] }),
  });
  assert.equal(result.readyForDryRun, false);
  assert.deepEqual(result.requiredUserActions, ["START_DEDICATED_CHROME"]);
});
