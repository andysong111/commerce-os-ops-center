const DEFAULT_SOURCING_ENGINE_URL = "https://commerce-os-sourcing-engine-indol.vercel.app";
const FINGERPRINT = /^sha256:[a-f0-9]{64}$/;

export type SourcingBudgetPlanSelection = {
  conceptId: string;
  canonicalNameKo: string;
  finalQualityScore: number | null;
  unitPriceCny: number | null;
  plannedCostKrw: number;
  moq: number;
  recommendedUnits: number;
  tier: "CORE" | "SUPPORT" | "CANARY";
  quantity: number;
  estimatedCostKrw: number;
  quantityReduced: boolean;
};

export type SourcingBudgetPlan = {
  version: "sourcing-budget-plan-v1";
  generatedAt: string;
  targetCycleMonth: string;
  totalCashKrw: number;
  sourcingBudgetPercent: number;
  sourcingBudgetKrw: number;
  state: "READY" | "BLOCKED" | "EMPTY";
  readyForConfirmation: boolean;
  blockers: string[];
  policy: {
    confirmed: boolean;
    budgetMode: string | null;
    operatorAllocationSupported: boolean;
    month: string | null;
    configuredPercent: number | null;
    maximumPercent: number | null;
    monthlyBudgetKrw: number | null;
    monthlyItemCap: number;
    version: number | null;
  };
  usage: { reservedItems: number; reservedCostKrw: number };
  warehouse: {
    ready: boolean;
    message: string;
    allocatableLarge: number;
    allocatableSmall: number;
  };
  policyPreparationRequired: boolean;
  allocation: {
    budgetKrw: number;
    alreadyReservedKrw: number;
    availableBudgetKrw: number;
    estimatedSpendKrw: number;
    remainingBudgetKrw: number;
    itemCapacity: number;
    selected: SourcingBudgetPlanSelection[];
    excluded: Array<{ conceptId: string; canonicalNameKo: string; reason: string }>;
  };
  sourceFingerprint: string;
  planFingerprint: string;
  businessWritesEnabled: false;
  externalOrderExecuted: false;
};

export type SourcingBudgetPlanInput = {
  targetCycleMonth: string;
  totalCashKrw: number;
  sourcingBudgetPercent: number;
  sourcingBudgetKrw: number;
};

export type SourcingBudgetConfirmationResult = {
  ok: boolean;
  status: "COMPLETE" | "PARTIAL";
  planFingerprint: string;
  selectedCount: number;
  confirmedCount: number;
  estimatedSourcingSpendKrw: number;
  remainingSourcingBudgetKrw: number;
  results: Array<Record<string, unknown>>;
  failure: { conceptId: string; code: string; message: string } | null;
  retryRequiresFreshPreflight: boolean;
  externalOrderExecuted: false;
};

function config(env: Readonly<Record<string, string | undefined>> = process.env) {
  const secret = (
    env.SOURCING_ENGINE_INTEGRATION_SECRET ||
    env.PRODUCT_MASTER_INTEGRATION_SECRET
  )?.trim();
  if (!secret) throw new Error("SOURCING_BUDGET_INTEGRATION_SECRET_REQUIRED");
  const protectionBypass = env.SOURCING_ENGINE_PROTECTION_BYPASS?.trim() || null;
  if (protectionBypass && /[\r\n]/.test(protectionBypass)) {
    throw new Error("SOURCING_BUDGET_PROTECTION_BYPASS_INVALID");
  }
  const raw = env.SOURCING_ENGINE_PUBLIC_URL?.trim() || DEFAULT_SOURCING_ENGINE_URL;
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("SOURCING_BUDGET_ENGINE_URL_INVALID");
  return { secret, protectionBypass, baseUrl: url.origin };
}

function requestHeaders(secret: string, protectionBypass: string | null) {
  return {
    "x-commerce-os-integration-secret": secret,
    ...(protectionBypass
      ? { "x-vercel-protection-bypass": protectionBypass }
      : {}),
    accept: "application/json",
  };
}

function assertPlan(value: unknown): asserts value is SourcingBudgetPlan {
  const plan = value as Partial<SourcingBudgetPlan> | null;
  if (
    !plan ||
    plan.version !== "sourcing-budget-plan-v1" ||
    !FINGERPRINT.test(String(plan.sourceFingerprint ?? "")) ||
    !FINGERPRINT.test(String(plan.planFingerprint ?? "")) ||
    !Array.isArray(plan.blockers) ||
    !Array.isArray(plan.allocation?.selected) ||
    !Array.isArray(plan.allocation?.excluded) ||
    plan.businessWritesEnabled !== false ||
    plan.externalOrderExecuted !== false
  ) {
    throw new Error("SOURCING_BUDGET_PLAN_RESPONSE_INVALID");
  }
}

async function responseJson(response: Response) {
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !payload) {
    const code = String(payload?.code ?? "SOURCING_BUDGET_ENGINE_FAILED").trim();
    const message = String(payload?.message ?? "").trim();
    throw new Error(code + (message ? ":" + message : ""));
  }
  return payload;
}

export async function loadSourcingBudgetPlan(
  input: SourcingBudgetPlanInput,
  options: { env?: Readonly<Record<string, string | undefined>> } = {},
): Promise<SourcingBudgetPlan> {
  const { secret, protectionBypass, baseUrl } = config(options.env);
  const params = new URLSearchParams({
    month: input.targetCycleMonth,
    totalCashKrw: String(input.totalCashKrw),
    sourcingBudgetPercent: String(input.sourcingBudgetPercent),
    sourcingBudgetKrw: String(input.sourcingBudgetKrw),
  });
  const response = await fetch(
    `${baseUrl}/api/integrations/sourcing-budget-plan?${params.toString()}`,
    {
      headers: requestHeaders(secret, protectionBypass),
      cache: "no-store",
      signal: AbortSignal.timeout(240_000),
    },
  );
  const payload = await responseJson(response);
  assertPlan(payload.plan);
  return payload.plan;
}

export async function confirmSourcingBudgetPlan(input: SourcingBudgetPlanInput & {
  expectedSourceFingerprint: string;
  expectedPlanFingerprint: string;
}, options: { env?: Readonly<Record<string, string | undefined>> } = {}): Promise<SourcingBudgetConfirmationResult> {
  const { secret, protectionBypass, baseUrl } = config(options.env);
  const response = await fetch(`${baseUrl}/api/integrations/sourcing-budget-plan/confirm`, {
    method: "POST",
    headers: {
      ...requestHeaders(secret, protectionBypass),
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
    cache: "no-store",
    signal: AbortSignal.timeout(580_000),
  });
  const payload = await responseJson(response) as SourcingBudgetConfirmationResult;
  if (
    !["COMPLETE", "PARTIAL"].includes(payload.status) ||
    payload.externalOrderExecuted !== false ||
    payload.planFingerprint !== input.expectedPlanFingerprint
  ) {
    throw new Error("SOURCING_BUDGET_CONFIRM_RESPONSE_INVALID");
  }
  return payload;
}
