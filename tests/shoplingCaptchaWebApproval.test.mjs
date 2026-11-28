import assert from "node:assert/strict";
import {
  constants as cryptoConstants,
  generateKeyPairSync,
  privateDecrypt,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadModule } from "./monthly-price-module.mjs";

test("Shopling CAPTCHA answer is accepted only for the current image and remains encrypted", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const now = new Date();
  const row = {
    status: "WAITING",
    image_data: `data:image/png;base64,${Buffer.alloc(256, 9).toString("base64")}`,
    image_hash: "9".repeat(64),
    image_version: 2,
    image_updated_at: now.toISOString(),
    answer_public_key: publicKey,
    answer_submitted_at: null,
    refresh_requested_at: null,
    expires_at: new Date(now.getTime() + 60_000).toISOString(),
    updated_at: now.toISOString(),
  };
  let updateBody = null;
  let updateSelected = false;

  function query() {
    let mode = "read";
    return {
      select() {
        if (mode === "update") updateSelected = true;
        return this;
      },
      update(value) {
        mode = "update";
        updateBody = value;
        return this;
      },
      eq() { return this; },
      gt() { return this; },
      in() { return this; },
      async maybeSingle() { return { data: row, error: null }; },
      then(resolve) {
        return Promise.resolve(resolve({ data: mode === "update" ? [row] : [row], error: null }));
      },
    };
  }

  const server = loadModule("../src/lib/shoplingCaptchaApproval.ts", {
    "@/lib/supabase/admin": {
      createSupabaseAdminClient: async () => ({ from: () => query() }),
    },
  });

  const stale = await server.submitShoplingCaptchaAnswer("A".repeat(43), "2541", 1);
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "SHOPLING_CAPTCHA_STALE");

  const accepted = await server.submitShoplingCaptchaAnswer("A".repeat(43), "2541", 2);
  assert.equal(accepted.ok, true);
  assert.equal(updateSelected, true);
  assert.notEqual(updateBody.answer_ciphertext, "2541");
  const decrypted = privateDecrypt({
    key: privateKey,
    padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: "sha256",
  }, Buffer.from(updateBody.answer_ciphertext, "base64")).toString("utf8");
  assert.equal(decrypted, "2541");
});

test("Shopling CAPTCHA storage is service-role-only and public responses are never cached", async () => {
  const [migration, api, image, client] = await Promise.all([
    readFile("supabase/migrations/202611190001_shopling_captcha_human_approval.sql", "utf8"),
    readFile("src/app/api/shopling-captcha/[token]/route.ts", "utf8"),
    readFile("src/app/api/shopling-captcha/[token]/image/route.ts", "utf8"),
    readFile("src/app/shopling-captcha/[token]/ShoplingCaptchaClient.tsx", "utf8"),
  ]);

  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all .* from anon, authenticated/);
  assert.match(migration, /grant select, insert, update, delete .* to service_role/);
  assert.match(api, /private, no-store/);
  assert.match(api, /imageVersion/);
  assert.match(image, /Content-Security-Policy/);
  assert.match(client, /새 캡차 요청/);
  assert.match(client, /setInterval\(\(\) => void refresh\(\), 3_000\)/);
});

test("a submitted phone answer reports an overdue PC confirmation and preserves the actual terminal result", async () => {
  const now = Date.now();
  const row = { status: "ANSWER_SUBMITTED", image_version: 2, image_hash: "a".repeat(64),
    expires_at: new Date(now + 120_000).toISOString(), answer_submitted_at: new Date(now).toISOString() };
  const query = { select() { return this; }, eq() { return this; }, maybeSingle() { return { data: row }; } };
  const server = loadModule("../src/lib/shoplingCaptchaApproval.ts", {
    "@/lib/supabase/admin": { createSupabaseAdminClient: async () => ({ from: () => query }) },
  });
  const read = async () => (await server.readShoplingCaptchaChallenge("A".repeat(43))).value;
  assert.equal((await read()).confirmationDelayed, false);
  row.answer_submitted_at = new Date(now - 120_000).toISOString();
  assert.equal((await read()).confirmationDelayed, true);
  row.expires_at = new Date(now - 10_000).toISOString();
  assert.equal((await read()).status, "EXPIRED");
  for (const status of ["CANCELLED", "CONSUMED"]) {
    row.status = status;
    const result = await read();
    assert.equal(result.status, status);
    assert.equal(result.expired, false);
    assert.equal(result.confirmationDelayed, false);
  }
});
