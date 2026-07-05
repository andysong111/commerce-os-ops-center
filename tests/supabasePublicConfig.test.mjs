import test from "node:test";
import assert from "node:assert/strict";
import { getSupabasePublicConfig } from "../src/lib/supabase/config.ts";
import { getSourcingStorageConfig, validateSourcingStorageConfig } from "../src/lib/sourcingServerStorage.ts";

test("Supabase PUBLISHABLE key works and is preferred", () => {
  const config = getSupabasePublicConfig({
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  });

  assert.equal(config.hasUrl, true);
  assert.equal(config.hasPublicKey, true);
  assert.equal(config.publicKey, "publishable-key");
  assert.equal(config.publicKeyName, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  assert.deepEqual(config.missing, []);
});

test("Supabase ANON key fallback works", () => {
  const config = getSupabasePublicConfig({
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  });

  assert.equal(config.hasUrl, true);
  assert.equal(config.hasPublicKey, true);
  assert.equal(config.publicKey, "anon-key");
  assert.equal(config.publicKeyName, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  assert.deepEqual(config.missing, []);
});

test("missing Supabase public key reports clear error", () => {
  const publicConfig = getSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" });
  const storageConfig = getSourcingStorageConfig({
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "server-only-secret",
  });
  const check = validateSourcingStorageConfig(storageConfig);

  assert.equal(publicConfig.hasPublicKey, false);
  assert.equal(publicConfig.publicKeyName, null);
  assert.deepEqual(publicConfig.missing, ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
  assert.equal(check.ok, false);
  assert.deepEqual(check.missing, ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
  assert.match(check.message, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY/);
});
