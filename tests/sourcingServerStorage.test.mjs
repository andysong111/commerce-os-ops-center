import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import {
  cardToRecommendationRow,
  normalizeRecommendationCardPayload,
  validateSourcingStorageConfig,
} from "../src/lib/sourcingServerStorage.ts";

test("Supabase API config guard reports missing env without throwing", () => {
  const check = validateSourcingStorageConfig({});
  assert.equal(check.ok, false);
  assert.deepEqual(check.missing, [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SECRET_KEY",
  ]);
  assert.match(check.message, /not configured/i);
});

test("card payload normalization clamps numbers and preserves full card payload for JSONB", () => {
  const card = normalizeRecommendationCardPayload({
    id: "card-1",
    decision: "NOPE",
    mode: "DISCOVER_NEW",
    koreanProductName: "  차량용 틈새 수납함  ",
    testQuantity: 12.8,
    targetPriceKrw: -500,
    estimatedTotalTestCostKrw: 10000.4,
    estimatedUnitCostKrw: 1333.9,
    riskLevel: "CAUTION",
    riskNotes: [" MOQ 확인 ", 5, ""],
    supplierQuestionsCn: ["可以混色吗？"],
  });

  assert.equal(card.decision, "ORDER_READY");
  assert.equal(card.mode, "DISCOVER_NEW");
  assert.equal(card.koreanProductName, "차량용 틈새 수납함");
  assert.equal(card.testQuantity, 13);
  assert.equal(card.targetPriceKrw, 0);
  assert.deepEqual(card.riskNotes, ["MOQ 확인"]);

  const row = cardToRecommendationRow(card, "org-1");
  assert.equal(row.organization_id, "org-1");
  assert.equal(row.card_payload.id, "card-1");
});

test("client components do not import the Supabase secret key or admin client", async () => {
  const offenders = [];
  for await (const file of glob("src/**/*.{ts,tsx}")) {
    const source = await readFile(file, "utf8");
    if (!source.includes('"use client"') && !source.includes("'use client'")) continue;
    if (source.includes("SUPABASE_SECRET_KEY") || source.includes("supabase/admin")) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});
