import assert from "node:assert/strict";
import test from "node:test";
import { createPurchaseAutomationServer } from "../local-agent/src/purchase-automation-server.mjs";

const draftId = "fast-purchase-draft:8c51000fd221316c2f54";

async function withServer(run, callback) {
  const server = createPurchaseAutomationServer({ purchaseAutomationPort: 0 }, {
    runAlibaba1688CartStaging: run,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("local purchase automation exposes 5-1 and 5-2 without order submission", async () => {
  const calls = [];
  await withServer(async (_config, options) => {
    calls.push(options);
    return { audit: { stage: options.mode === "cost-capture" ? "COST_CAPTURE_COMPLETE" : "CART_STAGING_COMPLETE" } };
  }, async (origin) => {
    const health = await fetch(`${origin}/health`).then((response) => response.json());
    assert.equal(health.externalOrderExecuted, false);

    const page = await fetch(`${origin}/?draftId=${encodeURIComponent(draftId)}&mode=cost-capture`).then((response) => response.text());
    assert.match(page, /5-1 원가·운임 기록/);
    assert.match(page, /textContent/);
    assert.doesNotMatch(page, /result\.innerHTML/);

    for (const mode of ["cost-capture", "cart-staging"]) {
      const response = await fetch(`${origin}/run`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ draftId, mode }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.externalOrderExecuted, false);
      assert.equal(body.checkoutSubmitted, false);
      assert.equal(body.paymentExecuted, false);
    }
  });
  assert.deepEqual(calls.map((call) => call.mode), ["cost-capture", "cart-staging"]);
  assert.ok(calls.every((call) => call.execute === true));
});

test("local purchase automation rejects cross-origin and malformed draft requests", async () => {
  let calls = 0;
  await withServer(async () => {
    calls += 1;
    return { audit: { stage: "COST_CAPTURE_COMPLETE" } };
  }, async (origin) => {
    const crossOrigin = await fetch(`${origin}/run`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://example.com" },
      body: JSON.stringify({ draftId, mode: "cost-capture" }),
    });
    assert.equal(crossOrigin.status, 403);

    const malformed = await fetch(`${origin}/?draftId=bad&mode=cost-capture`);
    assert.equal(malformed.status, 400);
  });
  assert.equal(calls, 0);
});
