import type { RecommendationCard, SourcingFeedback } from "@/lib/sourcingEngine";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

export type SourcingStorageConfig = {
  supabaseUrl?: string;
  supabasePublicKey?: string;
  supabasePublicKeyName?: string | null;
  supabaseSecretKey?: string;
};

export type ConfigCheck = { ok: true } | { ok: false; missing: string[]; message: string };

export function getSourcingStorageConfig(env: NodeJS.ProcessEnv = process.env): SourcingStorageConfig {
  const publicConfig = getSupabasePublicConfig(env);

  return {
    supabaseUrl: publicConfig.url,
    supabasePublicKey: publicConfig.publicKey,
    supabasePublicKeyName: publicConfig.publicKeyName,
    supabaseSecretKey: env.SUPABASE_SECRET_KEY,
  };
}

export function validateSourcingStorageConfig(config = getSourcingStorageConfig()): ConfigCheck {
  const missing = [
    ["NEXT_PUBLIC_SUPABASE_URL", config.supabaseUrl],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY", config.supabasePublicKey],
    ["SUPABASE_SECRET_KEY", config.supabaseSecretKey],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name as string);

  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      message: `Supabase server storage is not configured. Missing: ${missing.join(", ")}.`,
    };
  }

  return { ok: true };
}

export function notConfiguredResponse(check: Extract<ConfigCheck, { ok: false }>) {
  return Response.json(
    {
      ok: false,
      code: "SUPABASE_NOT_CONFIGURED",
      message: check.message,
      missing: check.missing,
      fallback: "Browser localStorage remains available for the MVP quick-save flow.",
    },
    { status: 503 },
  );
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function normalizeRecommendationCardPayload(payload: unknown): RecommendationCard {
  if (!payload || typeof payload !== "object") {
    throw new Error("Card payload must be an object.");
  }

  const card = payload as Partial<RecommendationCard>;
  return {
    id: asString(card.id, crypto.randomUUID()),
    decision: card.decision === "HOLD" || card.decision === "REJECT" ? card.decision : "ORDER_READY",
    decisionLabel: asString(card.decisionLabel, "Order ready"),
    mode: card.mode === "DISCOVER_NEW" ? "DISCOVER_NEW" : "FOLLOW_PROVEN",
    modeLabel: asString(card.modeLabel, "검증제품 따라팔기"),
    koreanProductName: asString(card.koreanProductName, "Untitled sourcing card").trim() || "Untitled sourcing card",
    shortDescription: asString(card.shortDescription),
    searchTermsCn: asStringArray(card.searchTermsCn),
    primary: card.primary ?? null,
    backups: Array.isArray(card.backups) ? card.backups : [],
    recommendedOptions: asStringArray(card.recommendedOptions),
    testQuantity: Math.max(0, Math.round(asNumber(card.testQuantity))),
    targetPriceKrw: Math.max(0, Math.round(asNumber(card.targetPriceKrw))),
    estimatedTotalTestCostKrw: Math.max(0, Math.round(asNumber(card.estimatedTotalTestCostKrw))),
    estimatedUnitCostKrw: Math.max(0, Math.round(asNumber(card.estimatedUnitCostKrw))),
    estimatedMarginRate: asNumber(card.estimatedMarginRate),
    maxLossKrw: Math.max(0, Math.round(asNumber(card.maxLossKrw))),
    riskLevel: card.riskLevel === "CAUTION" || card.riskLevel === "HOLD" || card.riskLevel === "BLOCKED" ? card.riskLevel : "LOW",
    riskNotes: asStringArray(card.riskNotes),
    recommendationReasons: asStringArray(card.recommendationReasons),
    supplierQuestionsCn: asStringArray(card.supplierQuestionsCn),
    costNotice: asString(card.costNotice),
    createdAt: asString(card.createdAt, new Date().toISOString()),
  };
}

export function cardToRecommendationRow(card: RecommendationCard, organizationId: string) {
  return {
    id: card.id,
    organization_id: organizationId,
    decision: card.decision,
    korean_product_name: card.koreanProductName,
    short_description: card.shortDescription,
    test_quantity: card.testQuantity,
    target_price_krw: card.targetPriceKrw,
    estimated_total_test_cost_krw: card.estimatedTotalTestCostKrw,
    estimated_unit_cost_krw: card.estimatedUnitCostKrw,
    estimated_margin_rate: card.estimatedMarginRate,
    risk_level: card.riskLevel,
    risk_notes: card.riskNotes,
    supplier_questions_cn: card.supplierQuestionsCn,
    card_payload: card,
    created_at: card.createdAt,
  };
}

export function normalizeFeedbackPayload(payload: unknown): SourcingFeedback {
  if (!payload || typeof payload !== "object") throw new Error("Feedback payload must be an object.");
  const feedback = payload as Partial<SourcingFeedback>;
  return {
    cardId: asString(feedback.cardId),
    mode: feedback.mode === "DISCOVER_NEW" ? "DISCOVER_NEW" : "FOLLOW_PROVEN",
    categoryHint: asString(feedback.categoryHint).trim(),
    humanOrderDecision: feedback.humanOrderDecision === "HOLD" || feedback.humanOrderDecision === "REJECTED" ? feedback.humanOrderDecision : "ORDERED",
    salesResult: feedback.salesResult === "SUCCESS" || feedback.salesResult === "NEUTRAL" || feedback.salesResult === "FAIL" ? feedback.salesResult : "UNKNOWN",
    reordered: Boolean(feedback.reordered),
    failureReasons: asStringArray(feedback.failureReasons),
    memo: asString(feedback.memo).trim(),
    createdAt: asString(feedback.createdAt, new Date().toISOString()),
  };
}

export function feedbackToRow(feedback: SourcingFeedback, organizationId: string) {
  return {
    organization_id: organizationId,
    card_id: feedback.cardId || null,
    human_order_decision: feedback.humanOrderDecision,
    sales_result: feedback.salesResult,
    reordered: feedback.reordered,
    failure_reasons: feedback.failureReasons,
    memo: feedback.memo,
    created_at: feedback.createdAt,
  };
}
