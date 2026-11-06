const LEGACY_POPUP_PATTERN =
  "https://a.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml*";
const CURRENT_POPUP_PATTERN =
  "https://kt.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml*";

function replaceOnce(
  source: string,
  before: string,
  after: string,
  label: string,
) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`shopling_stock_hf79_${label}_anchor_missing`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`shopling_stock_hf79_${label}_anchor_not_unique`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

function bothHostOriginCheck(pathConstant: string) {
  return `return ["https://a.shopling.co.kr", "https://kt.shopling.co.kr"].includes(parsed.origin) && parsed.pathname.toLowerCase() === ${pathConstant}.toLowerCase();`;
}

function bothHostQuery() {
  return `url: [
        "${LEGACY_POPUP_PATTERN}",
        "${CURRENT_POPUP_PATTERN}",
      ],`;
}

/**
 * HF79 fixes the gap left by HF78: the popup content script was injected on
 * kt.shopling.co.kr, but the background claim adapter still rejected that
 * exact popup URL and queried only the legacy a.shopling.co.kr host.
 */
export function patchHf79OptionClaimSource(source: string) {
  let next = replaceOnce(
    source,
    'return parsed.origin === "https://a.shopling.co.kr" && parsed.pathname.toLowerCase() === TARGET_PATH.toLowerCase();',
    bothHostOriginCheck("TARGET_PATH"),
    "option_claim_origin",
  );
  next = replaceOnce(
    next,
    `url: "${LEGACY_POPUP_PATTERN}",`,
    bothHostQuery(),
    "option_claim_query",
  );
  return next;
}

export function patchHf79SingleClaimSource(source: string) {
  let next = replaceOnce(
    source,
    'return parsed.origin === "https://a.shopling.co.kr" && parsed.pathname.toLowerCase() === POPUP_PATH.toLowerCase();',
    bothHostOriginCheck("POPUP_PATH"),
    "single_claim_origin",
  );
  next = replaceOnce(
    next,
    `url: "${LEGACY_POPUP_PATTERN}",`,
    bothHostQuery(),
    "single_claim_query",
  );
  return next;
}

export function patchHf79OptionListSource(source: string) {
  return replaceOnce(
    source,
    `const POPUP_MATCH = "${LEGACY_POPUP_PATTERN}";`,
    `const POPUP_MATCH = ["${LEGACY_POPUP_PATTERN}", "${CURRENT_POPUP_PATTERN}"];`,
    "option_list_query",
  );
}

export function patchHf79SingleListSource(source: string) {
  let next = replaceOnce(
    source,
    'return parsed.origin === "https://a.shopling.co.kr" && parsed.pathname.toLowerCase() === POPUP_PATH.toLowerCase();',
    bothHostOriginCheck("POPUP_PATH"),
    "single_list_origin",
  );
  next = replaceOnce(
    next,
    `url: "${LEGACY_POPUP_PATTERN}",`,
    bothHostQuery(),
    "single_list_query",
  );
  return next;
}

