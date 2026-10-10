const DEFAULT_SOURCING_ENGINE_URL = "https://commerce-os-sourcing-engine-indol.vercel.app";
const FINGERPRINT = /^sha256:[a-f0-9]{64}$/;
// Production candidate reads can take close to a minute while the sourcing data is cold.
const PREVIEW_REQUEST_TIMEOUT_MS = 90_000;
const PREVIEW_REQUEST_MAX_ATTEMPTS = 2;
const PREVIEW_RETRY_DELAY_MS = 750;
const TRANSIENT_PREVIEW_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export type SourcingVariantSelectionInput = {
  conceptId: string;
  variantKey: string;
  storageSize: "S" | "L";
};

export type SourcingSaleVariant = {
  variantKey: string;
  saleOption: string;
  chinaOption: string;
  unitPriceCny: number;
  source: "VISIBLE_1688_OPTION" | "MANUAL_INTAKE" | "LEGACY_COST_BASIS";
  defaultStorageSize: "S" | "L" | null;
};

export type SourcingBudgetPlanSelection = {
  conceptId: string;
  canonicalNameKo: string;
  sourceUrl?: string | null;
  finalQualityScore: number | null;
  unitPriceCny: number | null;
  plannedCostKrw: number;
  moq: number;
  recommendedUnits: number;
  tier: "CORE" | "SUPPORT" | "CANARY";
  quantity: number;
  estimatedCostKrw: number;
  quantityReduced: boolean;
  storageSize: "S" | "L" | null;
  storageSizeSource: "OPERATOR" | "MANUAL_INTAKE" | null;
  variants: SourcingSaleVariant[];
  selectedVariants: Array<SourcingSaleVariant & {
    storageSize: "S" | "L";
    storageSizeSource: "OPERATOR" | "MANUAL_INTAKE";
    quantity: number;
    estimatedCostKrw: number;
  }>;
};

export type SourcingBudgetPlan = {
  version: "sourcing-budget-plan-v1";
  generatedAt: string;
  targetCycleMonth: string;
  totalCashKrw: number;
  sourcingBudgetPercent: number;
  sourcingBudgetKrw: number;
  preferredConceptIds: string[];
  storageSizeByConceptId: Record<string, "S" | "L">;
  variantSelections: SourcingVariantSelectionInput[];
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
    availableCandidates: Array<{
      conceptId: string;
      canonicalNameKo: string;
      sourceUrl?: string | null;
      finalQualityScore: number | null;
      plannedCostKrw: number | null;
      moq: number | null;
      recommendedUnits: number;
      testPlanReady: boolean;
      variants: SourcingSaleVariant[];
    }>;
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
  preferredConceptIds?: string[];
  storageSizeByConceptId?: Record<string, "S" | "L">;
  variantSelections?: SourcingVariantSelectionInput[];
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

function validCandidateSourceUrl(value: unknown) {
  if (value == null) return true;
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "detail.1688.com" &&
      /^\/offer\/\d{5,}\.html$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function assertPlan(value: unknown): asserts value is SourcingBudgetPlan {
  const plan = value as Partial<SourcingBudgetPlan> | null;
  const selected = Array.isArray(plan?.allocation?.selected) ? plan.allocation.selected : [];
  const available = Array.isArray(plan?.allocation?.availableCandidates)
    ? plan.allocation.availableCandidates
    : [];
  const candidates = [
    ...selected,
    ...available,
  ];
  if (
    !plan ||
    plan.version !== "sourcing-budget-plan-v1" ||
    !FINGERPRINT.test(String(plan.sourceFingerprint ?? "")) ||
    !FINGERPRINT.test(String(plan.planFingerprint ?? "")) ||
    !Array.isArray(plan.blockers) ||
    !Array.isArray(plan.allocation?.selected) ||
    !Array.isArray(plan.allocation?.availableCandidates) ||
    !Array.isArray(plan.allocation?.excluded) ||
    candidates.some((candidate) =>
      !validCandidateSourceUrl(candidate.sourceUrl) ||
      !Array.isArray(candidate.variants) ||
      candidate.variants.some((variant) =>
        !variant ||
        typeof variant.variantKey !== "string" ||
        !variant.variantKey ||
        typeof variant.chinaOption !== "string" ||
        !variant.chinaOption
      )
    ) ||
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

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function isPreviewTimeout(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "TimeoutError" ||
    error.name === "AbortError" ||
    /(?:timed?\s*out|timeout|aborted due to timeout)/iu.test(error.message)
  );
}

function isTransientPreviewError(error: unknown) {
  return (
    isPreviewTimeout(error) ||
    error instanceof TypeError ||
    (error instanceof Error && /(?:fetch failed|network error|connection (?:reset|refused))/iu.test(error.message))
  );
}

function normalizedPreviewError(error: unknown) {
  if (isPreviewTimeout(error)) return new Error("SOURCING_BUDGET_ENGINE_TIMEOUT");
  if (isTransientPreviewError(error)) return new Error("SOURCING_BUDGET_ENGINE_UNAVAILABLE");
  return error instanceof Error ? error : new Error("SOURCING_BUDGET_ENGINE_FAILED");
}

async function fetchSourcingBudgetPreview(
  url: string,
  init: RequestInit,
  options: { requestTimeoutMs?: number; maxAttempts?: number; retryDelayMs?: number },
) {
  const requestTimeoutMs = Math.max(
    100,
    Math.min(120_000, Math.trunc(options.requestTimeoutMs ?? PREVIEW_REQUEST_TIMEOUT_MS)),
  );
  const maxAttempts = Math.max(
    1,
    Math.min(3, Math.trunc(options.maxAttempts ?? PREVIEW_REQUEST_MAX_ATTEMPTS)),
  );
  const retryDelayMs = Math.max(
    0,
    Math.min(2_000, Math.trunc(options.retryDelayMs ?? PREVIEW_RETRY_DELAY_MS)),
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (TRANSIENT_PREVIEW_STATUSES.has(response.status) && attempt < maxAttempts) {
        await response.body?.cancel().catch(() => undefined);
        if (retryDelayMs) await wait(retryDelayMs);
        continue;
      }
      return response;
    } catch (error) {
      if (!isTransientPreviewError(error) || attempt >= maxAttempts) {
        throw normalizedPreviewError(error);
      }
      if (retryDelayMs) await wait(retryDelayMs);
    }
  }

  throw new Error("SOURCING_BUDGET_ENGINE_UNAVAILABLE");
}

export async function loadSourcingBudgetPlan(
  input: SourcingBudgetPlanInput,
  options: {
    env?: Readonly<Record<string, string | undefined>>;
    requestTimeoutMs?: number;
    maxAttempts?: number;
    retryDelayMs?: number;
  } = {},
): Promise<SourcingBudgetPlan> {
  const { secret, protectionBypass, baseUrl } = config(options.env);
  const params = new URLSearchParams({
    month: input.targetCycleMonth,
    totalCashKrw: String(input.totalCashKrw),
    sourcingBudgetPercent: String(input.sourcingBudgetPercent),
    sourcingBudgetKrw: String(input.sourcingBudgetKrw),
  });
  for (const conceptId of input.preferredConceptIds ?? []) {
    params.append("preferredConceptId", conceptId);
  }
  for (const [conceptId, storageSize] of Object.entries(input.storageSizeByConceptId ?? {})) {
    params.append("storageSize", `${conceptId}:${storageSize}`);
  }
  for (const selection of input.variantSelections ?? []) {
    params.append("variantSelection", JSON.stringify(selection));
  }
  const response = await fetchSourcingBudgetPreview(
    `${baseUrl}/api/integrations/sourcing-budget-plan?${params.toString()}`,
    {
      headers: requestHeaders(secret, protectionBypass),
      cache: "no-store",
    },
    options,
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
