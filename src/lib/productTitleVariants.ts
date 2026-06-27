import type { ProductGroupMarketAccount } from "./productGroupMarketRegistry";
import type { ReviewedKeywordRow } from "./keywordReviewQueue";
import { getMarketsForProductGroup } from "./productGroupMarketRegistry";

export type ModifierCategory = "sizeShape" | "material" | "usePlace" | "function" | "config" | "benefit";
export type ProductTitleVariantSource = { goodsKey: string; productGroup: string; productGroupType: string; groupSuffix: string; baseTitle: string; originalTitle?: string; siteSrch?: string; };
export type ProductTitleVariant = { goodsKey: string; productGroup: string; productGroupType: string; groupSuffix: string; mallKey?: string; marketName?: string; accountIdLabel?: string; baseTitle: string; groupTitle: string; mallTitle: string; selectedModifier: string; modifierSource: string; wordOrderStrategy: string; };

export const SAFE_MODIFIERS: Record<ModifierCategory, string[]> = {
  sizeShape: ["미니", "소형", "대형", "슬림", "접이식", "휴대용"],
  material: ["스텐", "스테인리스", "실리콘", "플라스틱", "아크릴", "원목", "금속", "가죽", "벨벳"],
  usePlace: ["주방", "주방용", "욕실", "욕실용", "차량용", "사무실", "책상", "캠핑", "여행", "현관", "침실"],
  function: ["수납", "정리", "거치", "보관", "청소", "보호", "고정", "방지"],
  config: ["세트", "구성", "옵션", "리필", "1개입", "2개입"],
  benefit: ["간편", "깔끔", "공간활용", "다용도"],
};
const DISALLOWED = ["정품", "국산", "KC", "KC인증", "인증", "방수", "최저가", "무료배송", "1+1", "대용량", "업소용", "대량", "도매", "납품", "특허", "의료", "살균", "항균", "친환경"];
export const PRODUCT_GROUP_TITLE_VARIANT_POLICIES: Record<string, { modifierPriority: ModifierCategory[]; titlePattern: string; purpose: string }> = {
  도매1: { modifierPriority: ["material", "sizeShape", "function", "usePlace"], titlePattern: "modifier_first", purpose: "기본 스펙형" },
  도매2: { modifierPriority: ["function", "config", "sizeShape", "material"], titlePattern: "modifier_then_shuffled", purpose: "기능/구성형" },
  도매3: { modifierPriority: ["usePlace", "material", "function", "sizeShape"], titlePattern: "modifier_then_shuffled", purpose: "용도/재질형" },
  도매4: { modifierPriority: ["config", "sizeShape", "function", "material"], titlePattern: "modifier_then_shuffled", purpose: "구성/규격형" },
  소매1: { modifierPriority: ["usePlace", "sizeShape", "function", "benefit"], titlePattern: "consumer_search", purpose: "일반 검색형" },
  소매2: { modifierPriority: ["benefit", "sizeShape", "usePlace", "function"], titlePattern: "benefit_size_first", purpose: "생활/편의형" },
};
function compact(s: string) { return s.replace(/[\s,|/]+/g, " ").trim(); }
function sourceText(s: ProductTitleVariantSource) { return compact([s.baseTitle, s.originalTitle ?? "", s.siteSrch ?? ""].join(" ")); }
function contains(source: string, word: string) { return source.includes(word); }
function benefitSupported(source: string, word: string) { if (contains(source, word)) return true; if (word === "깔끔") return /정리|수납|인테리어/.test(source); if (word === "공간활용") return /정리|수납|공간/.test(source); if (word === "다용도") return /다용도|수납|정리|주방|욕실|차량/.test(source); if (word === "간편") return /간편|휴대|미니|소형|접이식/.test(source); return false; }
function modifierAllowed(source: string, category: ModifierCategory, word: string) { if (DISALLOWED.includes(word) && !contains(source, word)) return false; if (word === "휴대용") return /휴대|휴대용|여행|캠핑|미니|소형/.test(source); if (category === "benefit") return benefitSupported(source, word); return contains(source, word); }
export function extractSafeAttributeModifiers(source: ProductTitleVariantSource) {
  const text = sourceText(source);
  return Object.fromEntries(Object.entries(SAFE_MODIFIERS).map(([category, words]) => [category, words.filter((word) => modifierAllowed(text, category as ModifierCategory, word))])) as Record<ModifierCategory, string[]>;
}
function uniqueWords(title: string) { const seen = new Set<string>(); return compact(title).split(/\s+/).filter((w) => w && !seen.has(w) && seen.add(w)); }
function hash(value: string) { let h = 2166136261; for (const ch of value) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function stableShuffle(words: string[], seed: string) { return words.map((word, index) => ({ word, score: hash(`${seed}:${word}:${index}`) })).sort((a,b) => a.score - b.score).map(({word}) => word); }
function safeTitle(words: string[], fallback: string) { let selected = words.filter(Boolean); while (selected.join(" ").length > 100 && selected.length > 1) selected = selected.slice(0, -1); return selected.join(" ").trim() || fallback.trim().slice(0, 100) || "상품명 확인 필요"; }
function pickModifier(source: ProductTitleVariantSource) { const found = extractSafeAttributeModifiers(source); const policy = PRODUCT_GROUP_TITLE_VARIANT_POLICIES[source.productGroup]; for (const category of policy?.modifierPriority ?? ["sizeShape", "material", "function", "usePlace"]) { const word = found[category][0]; if (word) return { word, category }; } return { word: "", category: "" }; }
export function buildGroupTitleVariant(source: ProductTitleVariantSource): ProductTitleVariant {
  const baseWords = uniqueWords(source.baseTitle);
  const { word, category } = pickModifier(source);
  const words = word ? [word, ...baseWords.filter((w) => w !== word)] : stableShuffle(baseWords, `${source.productGroup}:${source.goodsKey}:group`);
  if (source.productGroup !== "도매1" && words.length > 2) words.push(words.splice(1, 1)[0]);
  const groupTitle = safeTitle(words, source.baseTitle);
  return { ...source, baseTitle: source.baseTitle, groupTitle, mallTitle: groupTitle, selectedModifier: word, modifierSource: category || "none", wordOrderStrategy: word ? `group_${source.productGroup}_${category}` : `group_${source.productGroup}_shuffle_only` };
}
export function buildMallSpecificTitleVariant(source: ProductTitleVariantSource, marketAccount: ProductGroupMarketAccount): ProductTitleVariant {
  const group = buildGroupTitleVariant(source);
  const modifier = group.selectedModifier;
  const words = uniqueWords(group.groupTitle).filter((word) => word !== modifier);
  let shuffled = stableShuffle(words, `${source.productGroup}:${marketAccount.mallKey}:${marketAccount.marketName}:${marketAccount.accountIdLabel}:${source.goodsKey}`);
  if (shuffled.join(" ") === words.join(" ") && shuffled.length > 1) shuffled = [...shuffled.slice(1), shuffled[0]];
  const titleWords = modifier ? [modifier, ...shuffled] : shuffled;
  return { ...group, mallKey: marketAccount.mallKey, marketName: marketAccount.marketName, accountIdLabel: marketAccount.accountIdLabel, mallTitle: safeTitle(titleWords, group.groupTitle), wordOrderStrategy: `${group.wordOrderStrategy}:mall_stable_shuffle` };
}
export function sourceFromReviewedRow(row: ReviewedKeywordRow): ProductTitleVariantSource { return { goodsKey: row.goodsKey, productGroup: row.productGroup ?? "상품그룹 확인 필요", productGroupType: row.productGroupType ?? "확인 필요", groupSuffix: row.groupSuffix ?? "", baseTitle: row.editedTitle.trim() || row.recommendedTitle.trim(), originalTitle: row.originalTitle, siteSrch: [row.editedSiteSrch, row.recommendedSiteSrch, row.originalSiteSrch, row.manualCandidateKeywords].join(", ") }; }
export function buildExpandedGroupMarketApplyItems(rows: ReviewedKeywordRow[], groupVariantEnabled: boolean) {
  const blockedRows: string[] = []; const seen = new Set<string>(); const items: Array<{ goods_key: string; mall_key: string; final_title: string; final_site_srch: string; product_group: string; product_group_type: string; group_suffix: string; market_name: string; account_id_label: string; }> = [];
  for (const row of rows.filter((r) => r.reviewStatus === "approved")) {
    const markets = getMarketsForProductGroup(row.productGroup ?? "");
    if (markets.length === 0) { blockedRows.push(`${row.goodsKey || "(missing goods_key)"}: 상품그룹 확인 필요`); continue; }
    const source = sourceFromReviewedRow(row);
    for (const market of markets) { const key = `${row.goodsKey.trim()}::${market.mallKey}`; if (seen.has(key)) continue; seen.add(key); const variant = groupVariantEnabled ? buildMallSpecificTitleVariant(source, market) : undefined; items.push({ goods_key: row.goodsKey.trim(), mall_key: market.mallKey, final_title: variant?.mallTitle ?? source.baseTitle, final_site_srch: row.editedSiteSrch.trim() || row.recommendedSiteSrch.trim(), product_group: market.productGroup, product_group_type: market.productGroupType, group_suffix: market.groupSuffix, market_name: market.marketName, account_id_label: market.accountIdLabel }); }
  }
  return { items, blockedRows };
}
