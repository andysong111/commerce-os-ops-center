import assert from "node:assert/strict";
import test from "node:test";
import {
  runShoplingFulfillmentPreflight,
  shoplingApiCredentialPresence,
} from "../local-agent/src/shopling-fulfillment-preflight.mjs";

const config = {
  shoplingOrigins: ["https://a.shopling.co.kr/"],
};

test("credential preflight exposes presence only, never secret values", () => {
  const env = {
    SHOPLING_LOGIN_ID: "private-login",
    SHOPLING_COMPANY_ID: "private-company",
    SHOPLING_API_AUTH_KEY: "private-key",
  };
  const result = shoplingApiCredentialPresence(env);
  assert.deepEqual(result, { loginId: true, companyId: true, authKey: true });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /private/);
});

test("preflight becomes ready only with one B12 tab, API credentials, and OCR", async () => {
  const result = await runShoplingFulfillmentPreflight(config, {
    env: {
      SHOPLING_LOGIN_ID: "id",
      SHOPLING_COMPANY_ID: "company",
      SHOPLING_API_AUTH_KEY: "key",
    },
  }, {
    listChromeTargets: async () => ({
      available: true,
      targets: [{ type: "page", url: "https://a.shopling.co.kr/order/dlvy_list.phtml" }],
    }),
    resolveTesseractExecutable: () => "C:/Tesseract/tesseract.exe",
  });
  assert.equal(result.readyForReadOnlyPhotoReview, true);
  assert.equal(result.externalWritesAllowed, false);
});

test("missing credentials fail readiness without hiding other diagnostics", async () => {
  const result = await runShoplingFulfillmentPreflight(config, { env: {} }, {
    listChromeTargets: async () => ({ available: false, targets: [] }),
    resolveTesseractExecutable: () => "",
  });
  assert.equal(result.apiConfigured, false);
  assert.equal(result.chromeDebugAvailable, false);
  assert.equal(result.localOcrConfigured, false);
  assert.equal(result.readyForReadOnlyPhotoReview, false);
});
