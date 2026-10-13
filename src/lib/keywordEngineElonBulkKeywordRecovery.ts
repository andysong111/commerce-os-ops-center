import {
  compactKeywordElonKey,
  keywordElonUtf8Bytes,
  normalizeKeywordElonText,
  type KeywordElonCandidate,
  type KeywordElonIdentity,
  type KeywordElonSourceDraft,
} from "./keywordEngineElonLabV2.ts";
import { filterKeywordElonProhibitedKeywords } from "./keywordEngineElonLabV2Step4.ts";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const OPENAI_TIMEOUT_MS = 35_000;
const DEFAULT_MODEL = "gpt-5-mini";
const TARGET_CANDIDATES = 24;
const SEARCH_TERM_BYTE_LIMIT = 30;
const MODIFIER_LIMIT = 10;
const SINGLE_CHAR_SEARCH_TOKENS = new Set(["캡"]);

// These words describe metadata or prose structure, not something a shopper should
// type into a marketplace search box. They were the source of bad V11 terms such as
// `형태버킷햇`, `있는버킷햇`, `재질실리콘`, `용도골프공전용`.
const SEARCH_META_STOPWORDS = new Set([
  "상품",
  "제품",
  "용품",
  "옵션",
  "모델",
  "모델번호",
  "번호",
  "단품",
  "세트",
  "구성",
  "기타",
  "일반",
  "사용",
  "사용용",
  "관련",
  "선택사항",
  "표준",
  "재질",
  "용도",
  "형태",
  "속성",
  "기능",
  "있는",
  "있음",
  "모양",
  "예시",
]);

const FORBIDDEN_SYNTHETIC_FRAGMENTS = [
  "재질",
  "용도",
  "형태",
  "있는",
  "있음",
  "선택사항",
  "모델번호",
  "옵션",
] as const;

type OpenAiPayload = {
  output_text?: unknown;
  output?: Array<{ content?: Array<{ type?: unknown; text?: unknown }> }>;
  error?: { message?: unknown };
};

export type KeywordElonBulkKeywordRecoveryInput = {
  identity: KeywordElonIdentity;
  source: KeywordElonSourceDraft;
  productName: string;
  customBlockedTerms: string[];
};

function openAiModel() {
  return (
    normalizeKeywordElonText(process.env.OPENAI_KEYWORD_ELON_MODEL)
    || normalizeKeywordElonText(process.env.OPENAI_KEYWORD_IDENTITY_MODEL)
    || normalizeKeywordElonText(process.env.OPENAI_MODEL)
    || DEFAULT_MODEL
  );
}

function outputText(payload: OpenAiPayload) {
  const direct = normalizeKeywordElonText(payload.output_text);
  if (direct) return direct;
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && normalizeKeywordElonText(content.text)) {
        return normalizeKeywordElonText(content.text);
      }
    }
  }
  return "";
}

function uniqueKeys(values: unknown[], limit = 60) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = compactKeywordElonKey(value);
    if (
      key.length < 2
      || /\d/.test(key)
      || keywordElonUtf8Bytes(key) > SEARCH_TERM_BYTE_LIMIT
      || seen.has(key)
    ) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= limit) break;
  }
  return out;
}

function phraseWords(value: unknown) {
  return normalizeKeywordElonText(value)
    .replace(/[^0-9A-Za-z가-힣]+/g, " ")
    .split(/\s+/)
    .map((word) => compactKeywordElonKey(word))
    .filter(
      (word) =>
        (word.length >= 2 || SINGLE_CHAR_SEARCH_TOKENS.has(word))
        && !/\d/.test(word)
        && /[가-힣]/.test(word)
        && keywordElonUtf8Bytes(word) <= SEARCH_TERM_BYTE_LIMIT
        && !SEARCH_META_STOPWORDS.has(word),
    );
}

function phraseKey(value: unknown) {
  return uniqueKeys([phraseWords(value).join("")], 1)[0] ?? "";
}

function coreParts(identity: KeywordElonIdentity) {
  const words = phraseWords(identity.coreProduct);
  const key = compactKeywordElonKey(identity.coreProduct);
  const noun = words.at(-1) ?? key;
  const head = words.length >= 2 ? words[0] : "";
  return {
    key,
    noun,
    head,
    requiredMarker: noun.length >= 2 ? noun : key,
    words,
  };
}

function trustedSearchPhrases(input: KeywordElonBulkKeywordRecoveryInput) {
  return [
    input.productName,
    input.identity.coreProduct,
    input.identity.identityAnchor,
    ...(input.identity.primarySeeds ?? []),
    input.identity.koreanProductIdentity,
  ];
}

function modifierSourcePhrases(input: KeywordElonBulkKeywordRecoveryInput) {
  return [
    ...trustedSearchPhrases(input),
    ...(input.identity.conditionalSeeds ?? []),
    ...(input.identity.functionModifiers ?? []),
    ...(input.identity.designShapeModifiers ?? []),
    ...(input.identity.specAttributes ?? []),
  ];
}

function trustedSearchKeys(input: KeywordElonBulkKeywordRecoveryInput) {
  return new Set(
    uniqueKeys(trustedSearchPhrases(input).map(phraseKey), 40),
  );
}

function recoveryKeywordLooksNatural(
  input: KeywordElonBulkKeywordRecoveryInput,
  keyword: string,
) {
  const key = compactKeywordElonKey(keyword);
  if (!key || /\d/.test(key) || keywordElonUtf8Bytes(key) > SEARCH_TERM_BYTE_LIMIT) {
    return false;
  }
  if (
    FORBIDDEN_SYNTHETIC_FRAGMENTS.some((fragment) =>
      key.includes(compactKeywordElonKey(fragment)),
    )
  ) {
    return false;
  }

  const trusted = trustedSearchKeys(input);
  if (trusted.has(key)) return true;

  // A synthetic recovery term must keep the product-type marker. This prevents
  // detached prose fragments such as `표면보호` or `스트라이프패턴줄무늬` from
  // becoming FINAL search keywords merely because they occur in identity text.
  const marker = coreParts(input.identity).requiredMarker;
  return Boolean(marker && key.includes(marker));
}

function modifierTokens(input: KeywordElonBulkKeywordRecoveryInput) {
  const core = coreParts(input.identity);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const phrase of modifierSourcePhrases(input)) {
    for (const token of phraseWords(phrase)) {
      if (
        seen.has(token)
        || core.words.includes(token)
        || token === core.key
        || token === core.noun
        || token.includes(core.noun)
        || SEARCH_META_STOPWORDS.has(token)
      ) {
        continue;
      }
      seen.add(token);
      result.push(token);
      if (result.length >= MODIFIER_LIMIT) return result;
    }
  }
  return result;
}

export function buildDeterministicBulkKeywordRecoverySeeds(
  input: KeywordElonBulkKeywordRecoveryInput,
) {
  const core = coreParts(input.identity);
  const seeds: unknown[] = trustedSearchPhrases(input).map(phraseKey);
  const modifiers = modifierTokens(input);

  if (core.noun) {
    // Natural short variants: `원형받침대`, `가전용받침대`, `패턴버킷햇`.
    for (const modifier of modifiers) {
      seeds.push(`${modifier}${core.noun}`);
    }
  }

  if (core.key && core.noun) {
    // Preserve the verified product type while allowing a factual modifier to lead:
    // `원형세탁기받침대`, `실리콘골프공커버`.
    for (const modifier of modifiers) {
      const startsWithCoreHead = core.head && modifier.startsWith(core.head);
      if (!startsWithCoreHead) seeds.push(`${modifier}${core.key}`);
    }
  }

  // Pair only factual modifiers and always end in the product noun. These come after
  // the simpler/full verified phrases, so the Shopling 10-term output consumes them
  // only when genuinely needed for a sparse product.
  if (core.noun) {
    for (let left = 0; left < modifiers.length; left += 1) {
      for (let right = left + 1; right < modifiers.length; right += 1) {
        seeds.push(`${modifiers[left]}${modifiers[right]}${core.noun}`);
      }
    }
  }

  return uniqueKeys(seeds, 60).filter((keyword) =>
    recoveryKeywordLooksNatural(input, keyword),
  );
}

function recoverySchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["keywords"],
    properties: {
      keywords: {
        type: "array",
        minItems: 10,
        maxItems: TARGET_CANDIDATES,
        items: { type: "string", minLength: 2, maxLength: 30 },
      },
    },
  };
}

async function aiSeeds(input: KeywordElonBulkKeywordRecoveryInput) {
  const apiKey = normalizeKeywordElonText(process.env.KEYWORD_ENGINE_OPENAI_API_KEY);
  if (!apiKey) return [] as string[];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  const core = coreParts(input.identity);
  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openAiModel(),
        store: false,
        max_output_tokens: 2_200,
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: [
                "당신은 한국 이커머스 검색어 보충 생성기다.",
                "상품 정체성과 직접 관련된 실제 쇼핑 검색어만 만든다.",
                "설명문 조각이나 메타데이터 단어를 검색어로 만들지 않는다: 재질, 용도, 형태, 있는, 옵션, 모델번호 같은 표현은 금지한다.",
                "모든 합성 검색어에는 제품 종류를 나타내는 핵심명사가 반드시 남아 있어야 한다.",
                `현재 제품 핵심 표지는 '${core.requiredMarker || core.key}' 이다.`,
                "브랜드명·상표명·경쟁사명은 절대 새로 만들지 않는다.",
                "의료기기·치료·진단, 임산부·임신·출산, 유아·영아·아동용품, 성인용품·성적 용도 표현은 절대 만들지 않는다.",
                "원본에 없는 효능·인증·재질·규격·대상을 상상하지 않는다.",
                "색상·수량·모델번호처럼 검색 가치가 낮은 변형어만으로 채우지 않는다.",
                "어순만 바꾼 의미 없는 중복보다 실제 사용자가 입력할 법한 짧은 명사구를 우선한다.",
                "각 검색어는 UTF-8 30bytes 이하가 되도록 짧게 만든다.",
                `가능하면 ${TARGET_CANDIDATES}개의 서로 다른 후보를 반환한다.`,
              ].join("\n"),
            }],
          },
          {
            role: "user",
            content: [{
              type: "input_text",
              text: JSON.stringify({
                productName: input.productName,
                koreanProductIdentity: input.identity.koreanProductIdentity,
                coreProduct: input.identity.coreProduct,
                identityAnchor: input.identity.identityAnchor,
                primarySeeds: input.identity.primarySeeds,
                conditionalSeeds: input.identity.conditionalSeeds,
                functionModifiers: input.identity.functionModifiers,
                designShapeModifiers: input.identity.designShapeModifiers,
                sourceTitle: input.source.chineseTitle,
                sourceOptions: input.source.optionText,
              }),
            }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "keyword_elon_bulk_keyword_recovery_v3",
            strict: true,
            schema: recoverySchema(),
          },
        },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    const raw = await response.text();
    let payload: OpenAiPayload = {};
    try {
      payload = JSON.parse(raw) as OpenAiPayload;
    } catch {
      return [];
    }
    if (!response.ok) return [];
    const resultText = outputText(payload);
    if (!resultText) return [];
    const parsed = JSON.parse(resultText) as { keywords?: unknown[] };
    return uniqueKeys(parsed.keywords ?? [], TARGET_CANDIDATES).filter((keyword) =>
      recoveryKeywordLooksNatural(input, keyword),
    );
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export function buildSafeBulkKeywordRecoveryCandidates(
  keywords: string[],
): KeywordElonCandidate[] {
  return keywords.map((keyword) => ({
    keyword,
    searchKey: keyword,
    searchKeyword: keyword,
    relevance: 90,
    shoppingIntent: 82,
    specificity: 78,
    titleEligible: true,
    rationale: "SEO 대량등록 FINAL 검색어 부족 자동복구 후보",
    sourceTags: ["bulk_keyword_recovery_v12"],
    totalSearch: null,
    pcSearch: null,
    mobileSearch: null,
    compIdx: null,
    plAvgDepth: null,
    demandScore: 15,
    competitionOpportunity: 55,
    qualityScore: 84,
    safetyPass: true,
    safetyReason: "STEP4+V10 재검증 전 자연어 복구 후보",
    dataConfidence: "low",
  }));
}

export async function generateSafeBulkKeywordSupplements(
  input: KeywordElonBulkKeywordRecoveryInput,
) {
  const deterministic = buildDeterministicBulkKeywordRecoverySeeds(input);
  const generated =
    deterministic.length >= TARGET_CANDIDATES
      ? []
      : await aiSeeds(input);
  const candidates = uniqueKeys([...deterministic, ...generated], 60).filter((keyword) =>
    recoveryKeywordLooksNatural(input, keyword),
  );
  if (!candidates.length) return [];

  const filtered = await filterKeywordElonProhibitedKeywords({
    identity: input.identity,
    candidates: buildSafeBulkKeywordRecoveryCandidates(candidates),
    customBlockedTerms: input.customBlockedTerms,
  });
  const allowed = new Set(filtered.allowedKeys.map((value) => compactKeywordElonKey(value)));
  return candidates
    .filter((keyword) => allowed.has(compactKeywordElonKey(keyword)))
    .slice(0, 30);
}
