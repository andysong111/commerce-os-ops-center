const DEFAULT_SOURCING_ENGINE_URL = "https://commerce-os-sourcing-engine-indol.vercel.app";
const MANUAL_PRODUCT_ENGINE_TIMEOUT_MS = 25_000;

export type ManualSourcingProductInput = {
  sourceUrl: string;
  productName: string;
  supplierName?: string;
  variants: Array<{
    saleOption: string;
    chinaOption: string;
    storageSize: "S" | "L";
    unitPriceCny?: number | null;
    moq?: number | null;
  }>;
};

export type ManualSourcingProductCandidate = {
  conceptId: string;
  duplicate: boolean;
  semanticJobQueued: boolean;
  saleOption: string;
  chinaOption: string;
  storageSize: "S" | "L";
};

export type ManualSourcingProductResult = {
  ok: true;
  status: "QUEUED_FOR_REVIEW";
  conceptId: string;
  duplicate: boolean;
  semanticJobQueued: boolean;
  sourceUrl: string;
  productName: string;
  storageSize: "S" | "L";
  productGroupKey: string;
  candidates: ManualSourcingProductCandidate[];
  externalOrderExecuted: false;
};

function config(env: Readonly<Record<string, string | undefined>> = process.env) {
  const secret = (
    env.SOURCING_ENGINE_INTEGRATION_SECRET ||
    env.PRODUCT_MASTER_INTEGRATION_SECRET
  )?.trim();
  if (!secret) throw new Error("MANUAL_PRODUCT_INTEGRATION_SECRET_REQUIRED");
  const protectionBypass = env.SOURCING_ENGINE_PROTECTION_BYPASS?.trim() || null;
  if (protectionBypass && /[\r\n]/.test(protectionBypass)) {
    throw new Error("MANUAL_PRODUCT_PROTECTION_BYPASS_INVALID");
  }
  const url = new URL(env.SOURCING_ENGINE_PUBLIC_URL?.trim() || DEFAULT_SOURCING_ENGINE_URL);
  if (url.protocol !== "https:") throw new Error("MANUAL_PRODUCT_ENGINE_URL_INVALID");
  return { secret, protectionBypass, baseUrl: url.origin };
}

function assertResult(value: unknown): asserts value is ManualSourcingProductResult {
  const result = value as Partial<ManualSourcingProductResult> | null;
  if (
    !result ||
    result.ok !== true ||
    result.status !== "QUEUED_FOR_REVIEW" ||
    typeof result.conceptId !== "string" ||
    !result.conceptId ||
    typeof result.productGroupKey !== "string" ||
    !Array.isArray(result.candidates) ||
    result.candidates.length < 1 ||
    result.candidates.some((candidate) => (
      !candidate || typeof candidate.conceptId !== "string" || !candidate.conceptId ||
      !["S", "L"].includes(String(candidate.storageSize)) ||
      typeof candidate.saleOption !== "string" || typeof candidate.chinaOption !== "string"
    )) ||
    result.externalOrderExecuted !== false
  ) {
    throw new Error("MANUAL_PRODUCT_ENGINE_RESPONSE_INVALID");
  }
}

export async function registerManualSourcingProduct(
  input: ManualSourcingProductInput,
  options: { env?: Readonly<Record<string, string | undefined>> } = {},
) {
  const { secret, protectionBypass, baseUrl } = config(options.env);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/integrations/manual-product-intake`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-commerce-os-integration-secret": secret,
        ...(protectionBypass ? { "x-vercel-protection-bypass": protectionBypass } : {}),
      },
      body: JSON.stringify(input),
      cache: "no-store",
      signal: AbortSignal.timeout(MANUAL_PRODUCT_ENGINE_TIMEOUT_MS),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || /aborted due to timeout|timed?\s*out/iu.test(error.message))
    ) {
      throw new Error("MANUAL_PRODUCT_ENGINE_TIMEOUT");
    }
    throw error;
  }
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !payload) {
    const code = String(payload?.code ?? "MANUAL_PRODUCT_ENGINE_FAILED").trim();
    const message = String(payload?.message ?? "").trim();
    throw new Error(code + (message ? `:${message}` : ""));
  }
  assertResult(payload);
  return payload;
}
