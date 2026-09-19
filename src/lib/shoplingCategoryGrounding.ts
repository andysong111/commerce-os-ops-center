import type { ShoplingCategorySearchProfile } from "./shoplingCategoryScoring.ts";

export async function runFallbackFirstCategoryGrounding<T>(options: {
  totalTimeoutMs: number;
  webSearchEnabled: boolean;
  requestFallback: (timeoutMs: number) => Promise<T>;
  requestWeb: (timeoutMs: number) => Promise<T>;
  merge: (fallback: T, web: T) => T;
  isFatalWebError: (error: unknown) => boolean;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const fallbackTimeoutMs = Math.min(
    15_000,
    Math.max(8_000, options.totalTimeoutMs - 18_000),
  );
  const fallback = await options.requestFallback(fallbackTimeoutMs);
  if (!options.webSearchEnabled) return fallback;

  const remainingMs = options.totalTimeoutMs - (now() - startedAt);
  if (remainingMs < 8_000) return fallback;
  try {
    const web = await options.requestWeb(
      Math.max(8_000, Math.min(18_000, remainingMs)),
    );
    return options.merge(fallback, web);
  } catch (error) {
    if (options.isFatalWebError(error)) throw error;
    return fallback;
  }
}

export function mergeGroundedShoplingCategoryProfiles(
  fallbackProfiles: ShoplingCategorySearchProfile[],
  webProfiles: ShoplingCategorySearchProfile[],
) {
  const fallbackById = new Map(
    fallbackProfiles.map((profile) => [text(profile.itemId), profile]),
  );
  return webProfiles.map((webProfile) => {
    const fallback = fallbackById.get(text(webProfile.itemId));
    if (!fallback) return webProfile;
    if (webProfile.groundingStatus !== "web") return fallback;
    return {
      ...fallback,
      ...webProfile,
      coreProductTerms: mergeProfileValues(
        webProfile.coreProductTerms,
        fallback.coreProductTerms,
        6,
      ),
      contextTerms: mergeProfileValues(
        webProfile.contextTerms,
        fallback.contextTerms,
        6,
      ),
      catalogCategoryTerms: mergeProfileValues(
        webProfile.catalogCategoryTerms,
        fallback.catalogCategoryTerms,
        10,
      ),
      productFormTerms: mergeProfileValues(
        webProfile.productFormTerms,
        fallback.productFormTerms,
        8,
      ),
      incompatibleCategoryTerms: mergeProfileValues(
        webProfile.incompatibleCategoryTerms,
        fallback.incompatibleCategoryTerms,
        12,
      ),
      blockedCategoryTerms: mergeProfileValues(
        webProfile.blockedCategoryTerms,
        fallback.blockedCategoryTerms,
        12,
      ),
      ignoredAttributes: mergeProfileValues(
        webProfile.ignoredAttributes,
        fallback.ignoredAttributes,
        10,
      ),
    };
  });
}

function mergeProfileValues(
  primary: readonly string[] | undefined,
  fallback: readonly string[] | undefined,
  limit: number,
) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of [...(primary ?? []), ...(fallback ?? [])]) {
    const normalized = text(value);
    const key = normalized
      .toLocaleLowerCase("ko-KR")
      .replace(/[^0-9a-z가-힣]/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
