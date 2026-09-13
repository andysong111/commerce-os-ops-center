/** Single-axis semantic names; Toss category-template approval is a separate gate.
 * Never split values, invent combinations, or modify option identity/price/stock.
 * This draft-side classifier is deliberately conservative. Unknown values retain
 * the generic name and the existing shared upload-worker fail-closed check.
 */
export const OPTION_NAME_RULE_VERSION = "2026-09-13.1";
type Row = Record<string, unknown>;
const GENERIC = /^(?:옵션\s*\d*|option\s*\d*|구성|선택)$/i;
const COLORS = new Set((
  "블랙 화이트 그레이 회색 핑크 레드 빨강 블루 파랑 네이비 베이지 브라운 갈색 그린 초록 " +
  "옐로우 노랑 퍼플 보라 오렌지 주황 실버 은색 골드 금색 투명 클리어 아이보리 카키 민트 와인 라벤더 " +
  "라임 라임색 스카이 스카이블루 하늘색 black white gray grey pink red blue navy beige brown green yellow purple orange silver gold clear ivory khaki mint lime sky"
).split(" "));
const SHAPE = /^(?:액자형|볼트형|원형|사각형|직사각형|삼각형|타원형|일자형|L자형|U자형|T자형)(?:\s*\d+\s*(?:개|개입|입|매|장|쌍|세트|팩|EA|PCS?|P))?$/i;
const QUANTITY = /^(?:\d+\s*(?:개|개입|입|매|장|쌍|세트|팩|봉|병|롤|EA|PCS?|PIECES?|P)|\d+\s*\+\s*\d+(?:\s*(?:개|개입|입|세트))?)$/i;
const SIZES = new Set("XS S M L XL XXL XXXL 소형 중형 대형 특대 특대형 미니 SMALL MEDIUM LARGE 프리사이즈".split(" "));
const MATERIALS = new Set("실리콘 스테인리스 스텐 알루미늄 플라스틱 아크릴 유리 세라믹 도자기 나무 우드 금속 철제 면 코튼 폴리에스터 나일론 가죽 pu silicone stainless aluminum aluminium plastic acrylic glass ceramic wood metal cotton polyester nylon leather".split(" "));
const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
function row(v: unknown): Row { return v !== null && typeof v === "object" && !Array.isArray(v) ? v as Row : {}; }
function generic(v: string) { return !v || GENERIC.test(v); }
function color(value: string): boolean {
  const valueWithoutPins = value.replace(/\s+\d+\s*핀$/i, "").trim().toLowerCase();
  if (["free", "랜덤", "랜덤발송", "sky blue"].includes(valueWithoutPins)) return true;
  return COLORS.has(valueWithoutPins) || COLORS.has(valueWithoutPins.replace(/^(?:진|연|다크|라이트|딥|파스텔|형광)\s*/, ""));
}
export function inferProductLaunchOptionName(values: unknown[]): string | null {
  if (!values.length || values.some(v => !text(v))) return null;
  const clean = values.map(text);
  if (clean.every(v => v === "단품")) return "단품";
  if (clean.every(v => QUANTITY.test(v))) return "수량";
  if (clean.every(v => SIZES.has(v.toUpperCase()) || v === "FREE SIZE")) return "사이즈";
  // Keep color+pin-count alternatives as one axis; retain the FULL value and SKU.
  if (clean.every(color)) return "색상";
  if (clean.every(v => SHAPE.test(v))) return "형태";
  if (clean.every(v => MATERIALS.has(v.toLowerCase()))) return "재질";
  if (clean.every(v => /^\d+(?:\.\d+)?\s*(?:ML|L|CC|OZ|리터)$/i.test(v))) return "용량";
  if (clean.every(v => /^\d+(?:\.\d+)?\s*(?:G|KG|그램|킬로그램)$/i.test(v))) return "무게";
  return null;
}
export function normalizeProductLaunchOptionNames<T extends Row>(
  item: T,
  options: { preserveRegistered?: boolean } = {},
): T {
  if (options.preserveRegistered && Object.values(row(item.shoplingProducts)).some(v => row(v).status === "success")) return item;
  if (!Array.isArray(item.orderOptions) || !item.orderOptions.length) return item;
  if (item.orderOptions.some(v => v === null || typeof v !== "object" || Array.isArray(v))) return item;
  const entries = item.orderOptions.map(row);
  const inferable = entries.every(option => {
    const title = text(option.optionName);
    const audit = row(option.optionNameNormalization);
    return generic(title) || (audit.source === "semantic_option_name" && title === audit.resolvedTitle && generic(text(audit.originalTitle)));
  });
  // Do not overwrite explicit human names or collapse differently named axes.
  if (!inferable) return item;
  const resolved = inferProductLaunchOptionName(entries.map(option => option.saleOption ?? option.value));
  let changed = false;
  const orderOptions = entries.map(option => {
    const previous = row(option.optionNameNormalization);
    const wasAuto = previous.source === "semantic_option_name" && text(option.optionName) === previous.resolvedTitle;
    const originalTitle = wasAuto ? text(previous.originalTitle) : text(option.optionName);
    const title = resolved || originalTitle || "옵션";
    if (!resolved && !wasAuto) return option;
    const audit = {
      source: "semantic_option_name", version: OPTION_NAME_RULE_VERSION,
      originalTitle, resolvedTitle: title,
    };
    if (option.optionName === title && JSON.stringify(previous) === JSON.stringify(audit)) return option;
    changed = true;
    return { ...option, optionName: title, optionNameNormalization: audit };
  });
  return changed ? { ...item, orderOptions } : item;
}
/** Normalize only unregistered drafts on ordinary saves. Existing live products
 * remain unchanged; an explicit re-registration normalizes its target separately.
 */
export function normalizeNewProductLaunchState<T extends Row>(state: T): T {
  if (!Array.isArray(state.items)) return state;
  let changed = false;
  const items = state.items.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const next = normalizeProductLaunchOptionNames(value as Row, { preserveRegistered: true });
    if (next !== value) changed = true;
    return next;
  });
  return changed ? { ...state, items } : state;
}
