import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getServerFallbackMessage, saveCardToLocalStorage } from "../src/lib/sourcingClientStorage.ts";
import { validateSourcingStorageConfig } from "../src/lib/sourcingServerStorage.ts";

test("auth client routes do not import SUPABASE_SECRET_KEY", async () => {
  const login = await readFile(new URL("../src/app/login/page.tsx", import.meta.url), "utf8");
  const callback = await readFile(new URL("../src/app/auth/callback/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(login, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(callback, /SUPABASE_SECRET_KEY/);
});

test("card local fallback upserts latest card and reports auth fallback", () => {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const card = { id: "card-1", decision: "ORDER_READY", decisionLabel: "Order ready", mode: "FOLLOW_PROVEN", modeLabel: "검증제품 따라팔기", koreanProductName: "상품", shortDescription: "", searchTermsCn: [], primary: null, backups: [], recommendedOptions: [], testQuantity: 1, targetPriceKrw: 1000, estimatedTotalTestCostKrw: 1000, estimatedUnitCostKrw: 1000, estimatedMarginRate: 0.2, maxLossKrw: 0, riskLevel: "LOW", riskNotes: [], recommendationReasons: [], supplierQuestionsCn: [], costNotice: "", createdAt: "2026-07-04T00:00:00.000Z" };
  assert.equal(saveCardToLocalStorage(card, storage).length, 1);
  assert.equal(saveCardToLocalStorage({ ...card, koreanProductName: "수정" }, storage).length, 1);
  assert.match(getServerFallbackMessage({ ok: false, code: "AUTH_REQUIRED", message: "login" }), /Local saved/);
});

test("server API not configured guard reports missing keys", () => {
  const check = validateSourcingStorageConfig({});
  assert.equal(check.ok, false);
  assert.deepEqual(check.missing, ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SECRET_KEY"]);
});
