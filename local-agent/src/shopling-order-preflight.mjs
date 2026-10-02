import {
  evaluateCdpExpressionAcrossFrames,
  listChromeTargets,
  shoplingTargets,
  withCdpTarget,
} from "./chrome-cdp.mjs";
import { redactUrl, sanitizeError } from "./safe-json.mjs";

const STAGE_PRIORITY = {
  LABEL_DOCUMENT: 70,
  LABEL_SETTINGS: 60,
  B12_COURIER: 50,
  B7_ORDER_PROCESSING: 40,
  B5_MAPPING: 30,
  B1_COLLECTION: 20,
  SHOPLING_ORDER_PAGE: 10,
  UNKNOWN: 0,
};

export function inferShoplingOrderStage(targetOrUrl, title = "") {
  const url = typeof targetOrUrl === "string" ? targetOrUrl : targetOrUrl?.url || "";
  const text = `${title || targetOrUrl?.title || ""} ${url}`;
  if (/dlvy_print\/018_003_chrome\.phtml|shopling\s*송장\s*출력/i.test(text)) return "LABEL_DOCUMENT";
  if (/dlvy_print_setting|송장출력\s*설정/i.test(text)) return "LABEL_SETTINGS";
  if (/\/order\/dlvy_list\.phtml|\[B12\]|택배사연동배송처리/i.test(text)) return "B12_COURIER";
  if (/\/order\/order_list\.phtml|\[B7\]|주문처리/i.test(text)) return "B7_ORDER_PROCESSING";
  if (/\/order\/mapping2\/order_mapping_1n_Lst\.phtml|\[B5\]|신규주문매핑처리/i.test(text)) return "B5_MAPPING";
  if (/\[B1\]|주문자동수집|order[^/]*(?:gather|collect)/i.test(text)) return "B1_COLLECTION";
  if (/\/order\//i.test(url)) return "SHOPLING_ORDER_PAGE";
  return "UNKNOWN";
}

function shoplingOrderProbe() {
  const text = document.body?.innerText || "";
  const url = location.href;
  const title = document.title || "";
  const selectedOptions = Array.from(document.querySelectorAll("select")).slice(0, 80).map((element) => ({
    id: String(element.id || "").slice(0, 100),
    name: String(element.name || "").slice(0, 100),
    text: String(element.selectedOptions?.[0]?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
    value: String(element.value || "").slice(0, 120),
  }));
  const dateInputs = Array.from(document.querySelectorAll("input")).filter((element) => {
    const key = `${element.id || ""} ${element.name || ""}`;
    return /(?:^|_)(?:start|end|from|to)?(?:date|dt)(?:_|$)/i.test(key) || element.type === "date";
  }).slice(0, 20).map((element) => ({
    id: String(element.id || "").slice(0, 100),
    name: String(element.name || "").slice(0, 100),
    value: String(element.value || "").slice(0, 20),
  }));
  const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
  const resultMatch = text.match(/총\s*조회수\s*:?\s*([0-9,]+)\s*건/);
  const labelPages = Array.from(text.matchAll(/\[(\d+)\s*\/\s*(\d+)\]/g));
  const labelPageCount = labelPages.reduce((maximum, match) => Math.max(maximum, Number(match[2]) || 0), 0);
  let stage = "UNKNOWN";
  if (/dlvy_print\/018_003_chrome\.phtml/i.test(url) || labelPageCount > 0) stage = "LABEL_DOCUMENT";
  else if (/송장출력\s*설정/i.test(text)) stage = "LABEL_SETTINGS";
  else if (/\/order\/dlvy_list\.phtml/i.test(url) || /\[B12\]\s*택배사연동배송처리/i.test(text)) stage = "B12_COURIER";
  else if (/\/order\/order_list\.phtml/i.test(url) || /\[B7\]\s*주문처리/i.test(text)) stage = "B7_ORDER_PROCESSING";
  else if (/\/order\/mapping2\/order_mapping_1n_Lst\.phtml/i.test(url) || /\[B5\]\s*신규주문매핑처리/i.test(text)) stage = "B5_MAPPING";
  else if (/\[B1\]\s*주문자동수집/i.test(text)) stage = "B1_COLLECTION";
  else if (/\/order\//i.test(url)) stage = "SHOPLING_ORDER_PAGE";
  return {
    url,
    title,
    stage,
    resultCount: resultMatch ? Number(resultMatch[1].replace(/,/g, "")) : null,
    checkboxCount: checkboxes.length,
    checkedCount: checkboxes.filter((element) => element.checked).length,
    labelPageCount: labelPageCount || null,
    selectedOptions,
    dateInputs,
  };
}

export const SHOPLING_ORDER_PREFLIGHT_EXPRESSION = `(${shoplingOrderProbe.toString()})()`;

function selectBestOrderFrame(results) {
  return [...(results || [])].sort((left, right) => {
    const leftScore = (STAGE_PRIORITY[left?.value?.stage] || 0) * 100 + Number(left?.frame?.depth || 0);
    const rightScore = (STAGE_PRIORITY[right?.value?.stage] || 0) * 100 + Number(right?.frame?.depth || 0);
    return rightScore - leftScore;
  })[0] || null;
}

export async function probeShoplingOrderTarget(target, options = {}) {
  return withCdpTarget(target, async (session) => {
    const results = await evaluateCdpExpressionAcrossFrames(session, SHOPLING_ORDER_PREFLIGHT_EXPRESSION, options);
    const selected = selectBestOrderFrame(results);
    if (!selected) return null;
    return {
      ...selected.value,
      url: redactUrl(selected.value.url),
      frame: selected.frame,
      inspectedFrameCount: results.length,
    };
  }, options);
}

export async function createShoplingOrderPreflight(config, dependencies = {}) {
  const listTargets = dependencies.listChromeTargets || listChromeTargets;
  const probeTarget = dependencies.probeShoplingOrderTarget || probeShoplingOrderTarget;
  const listed = await listTargets(config);
  const targets = shoplingTargets(listed.targets || [], config.shoplingOrigins);
  const pages = [];

  for (const target of targets) {
    try {
      const probe = await probeTarget(target);
      pages.push({
        targetId: target.id,
        title: target.title,
        url: redactUrl(target.url),
        stage: probe?.stage || inferShoplingOrderStage(target),
        probe,
        error: null,
      });
    } catch (error) {
      pages.push({
        targetId: target.id,
        title: target.title,
        url: redactUrl(target.url),
        stage: inferShoplingOrderStage(target),
        probe: null,
        error: sanitizeError(error, "SHOPLING_ORDER_PROBE_FAILED"),
      });
    }
  }

  const active = [...pages].sort((left, right) => (
    (STAGE_PRIORITY[right.stage] || 0) - (STAGE_PRIORITY[left.stage] || 0)
  ))[0] || null;

  return {
    event: "shopling_order_preflight",
    timestamp: new Date().toISOString(),
    mode: "READ_ONLY",
    chromeAvailable: listed.available,
    chromeError: listed.error || null,
    shoplingTabCount: pages.length,
    activeStage: active?.stage || "UNKNOWN",
    pages,
    safeguards: {
      mutatesOrders: false,
      submitsForms: false,
      triggersPrint: false,
      storesRecipientData: false,
    },
  };
}
