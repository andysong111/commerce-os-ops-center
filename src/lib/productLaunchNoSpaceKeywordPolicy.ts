import type {
  KeywordRecommendationGroup,
  KeywordRecommendationItem,
} from "./productLaunchKeywordRecommendations";
import { isOpsExactProhibitedKeyword } from "./keywordExactProhibitedTerms";

export type NoSpacePlanValidation =
  | { ok: true; rowCount: number }
  | { ok: false; message: string; goodsKey?: string; keyword?: string };

function text(value: unknown) {
  return String(value ?? "").trim();
}

export function isNoSpaceSearchKeyword(value: unknown) {
  const keyword = text(value);
  return Boolean(keyword) && !/\s/.test(keyword);
}

function exactIdentity(value: string) {
  return value.toLocaleLowerCase();
}

function dedupeNoSpaceKeywords(values: unknown[], limit = 30) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const keyword = text(value);
    if (!isNoSpaceSearchKeyword(keyword)) continue;
    if (isOpsExactProhibitedKeyword(keyword)) continue;
    const identity = exactIdentity(keyword);
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(keyword);
    if (result.length >= limit) break;
  }
  return result;
}

function sanitizeItems(items: KeywordRecommendationItem[]) {
  const seen = new Set<string>();
  const result: KeywordRecommendationItem[] = [];
  let excludedSpacingCount = 0;
  let excludedProhibitedCount = 0;
  for (const item of items ?? []) {
    const keyword = text(item.keyword);
    if (!isNoSpaceSearchKeyword(keyword)) {
      excludedSpacingCount += 1;
      continue;
    }
    if (isOpsExactProhibitedKeyword(keyword)) {
      excludedProhibitedCount += 1;
      continue;
    }
    const identity = exactIdentity(keyword);
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push({ ...item, keyword });
  }
  return { items: result, excludedSpacingCount, excludedProhibitedCount };
}

export function sanitizeNoSpaceRecommendationGroup(
  group: KeywordRecommendationGroup,
): KeywordRecommendationGroup {
  const sanitized = sanitizeItems(group.items ?? []);
  const byKeyword = new Map(
    sanitized.items.map((item) => [exactIdentity(item.keyword), item]),
  );
  const optimizedKeywords = dedupeNoSpaceKeywords(
    group.optimizedKeywords ?? [],
    10,
  ).filter(
    (keyword) =>
      byKeyword.get(exactIdentity(keyword))?.safeAutoApply === true,
  );
  const warnings = [...(group.warnings ?? [])];
  if (sanitized.excludedSpacingCount > 0) {
    warnings.push(
      `띄어쓰기 포함 후보 ${sanitized.excludedSpacingCount}개는 붙여쓰기 SearchAd 지표가 아니므로 제외했습니다.`,
    );
  }
  if (sanitized.excludedProhibitedCount > 0) {
    warnings.push(
      `OPS 고정 사용금지 키워드 ${sanitized.excludedProhibitedCount}개는 정확 일치 기준으로 제외했습니다.`,
    );
  }
  if (optimizedKeywords.length < 10) {
    warnings.push(
      `붙여쓰기 exact 지표로 자동 적용 가능한 키워드가 ${optimizedKeywords.length}개입니다.`,
    );
  }
  return {
    ...group,
    items: sanitized.items,
    optimizedKeywords,
    warnings: [...new Set(warnings)],
  };
}

export function sanitizeNoSpaceRecommendationResult<T extends object>(
  result: T,
): T {
  const source = result as T & {
    recommendations?: unknown;
  };
  if (!Array.isArray(source.recommendations)) return result;
  const recommendations = source.recommendations.filter(
    (value): value is KeywordRecommendationGroup =>
      Boolean(value) && typeof value === "object" && !Array.isArray(value),
  );
  return {
    ...result,
    recommendations: recommendations.map(sanitizeNoSpaceRecommendationGroup),
  } as T;
}

function parsePlan(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function splitFinalSiteSrch(value: unknown) {
  return text(value)
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

export function validateNoSpaceExecutionPlan(
  executionPlanJson: unknown,
): NoSpacePlanValidation {
  const rows = parsePlan(executionPlanJson);
  if (!rows) {
    return {
      ok: false,
      message: "상품명·검색어 실행계획 JSON을 읽을 수 없습니다.",
    };
  }
  for (const value of rows) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {
        ok: false,
        message: "실행계획 행 형식이 올바르지 않습니다.",
      };
    }
    const row = value as Record<string, unknown>;
    const goodsKey = text(row.goods_key);
    const keywords = splitFinalSiteSrch(row.final_site_srch);
    if (keywords.length !== 10) {
      return {
        ok: false,
        goodsKey,
        message: `${goodsKey || "상품번호 없음"}: 검색어는 정확히 10개여야 합니다.`,
      };
    }
    for (const keyword of keywords) {
      if (isOpsExactProhibitedKeyword(keyword)) {
        return {
          ok: false,
          goodsKey,
          keyword,
          message: `${goodsKey || "상품번호 없음"}: OPS 고정 사용금지 키워드 '${keyword}'는 전송할 수 없습니다.`,
        };
      }
      if (!isNoSpaceSearchKeyword(keyword)) {
        return {
          ok: false,
          goodsKey,
          keyword,
          message: `${goodsKey || "상품번호 없음"}: 띄어쓰기 검색어 '${keyword}'는 전송할 수 없습니다. 키워드 엔진에서 해당 붙여쓰기 문자열의 SearchAd 지표를 다시 조회해야 합니다.`,
        };
      }
    }
  }
  return { ok: true, rowCount: rows.length };
}
