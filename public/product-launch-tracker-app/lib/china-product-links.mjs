export const MAX_CHINA_PRODUCT_LINKS = 5;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value) {
  return String(value ?? "").trim();
}

export function normalizeChinaProductUrl(value) {
  let candidate = text(value);
  if (!candidate) return "";
  if (candidate.length > 4000) {
    throw new Error("중국 상품링크는 4,000자 이하로 입력하세요.");
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) && candidate.includes(".")) {
    candidate = `https://${candidate}`;
  }
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`올바른 인터넷 주소가 아닙니다: ${candidate.slice(0, 80)}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("중국 상품링크는 http 또는 https 주소만 사용할 수 있습니다.");
  }
  return parsed.toString();
}

export function normalizeChinaProductLinks(values) {
  const source = Array.isArray(values) ? values : [values];
  const seen = new Set();
  const links = [];
  for (const value of source) {
    const normalized = normalizeChinaProductUrl(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    links.push(normalized);
    if (links.length >= MAX_CHINA_PRODUCT_LINKS) break;
  }
  return links;
}

export function promoteChinaProductLink(values, selectedIndex) {
  const source = Array.from({ length: MAX_CHINA_PRODUCT_LINKS }, (_, index) =>
    text(Array.isArray(values) ? values[index] : ""),
  );
  const index = Number(selectedIndex);
  if (!Number.isInteger(index) || index < 0 || index >= source.length) {
    throw new Error("1번으로 고정할 링크 위치를 확인하세요.");
  }
  const selected = normalizeChinaProductUrl(source[index]);
  if (!selected) throw new Error("링크를 입력한 뒤 1번으로 고정하세요.");
  const reordered = [selected, ...source.filter((_, current) => current !== index)];
  const normalized = normalizeChinaProductLinks(reordered);
  return [...normalized, ...Array(MAX_CHINA_PRODUCT_LINKS - normalized.length).fill("")];
}

export function readChinaProductLinks(item) {
  const source = record(item);
  const detailPageSource = record(source.detailPageSource);
  const primary = text(
    source.primaryChinaProductLink ?? detailPageSource.primaryUrl,
  );
  const candidates = [
    primary,
    ...(Array.isArray(source.chinaProductLinks) ? source.chinaProductLinks : []),
    ...(Array.isArray(detailPageSource.urls) ? detailPageSource.urls : []),
  ];
  return normalizeChinaProductLinks(candidates);
}

export function applyChinaProductLinks(
  item,
  values,
  { now = new Date(), updatedBy = "승준" } = {},
) {
  const source = record(item);
  const links = normalizeChinaProductLinks(values);
  const primaryUrl = links[0] ?? "";
  const updatedAt = now.toISOString();
  return {
    ...source,
    chinaProductLinks: links,
    primaryChinaProductLink: primaryUrl,
    detailPageSource: {
      ...record(source.detailPageSource),
      primaryUrl,
      urls: links,
      pinnedIndex: primaryUrl ? 0 : null,
      source: "product_launch_tracker",
      updatedAt,
    },
    updatedAt,
    updatedBy,
  };
}

export function sameChinaProductLinks(item, values) {
  const current = readChinaProductLinks(item);
  const next = normalizeChinaProductLinks(values);
  return JSON.stringify(current) === JSON.stringify(next);
}

export function normalizeChinaLinkUsage(value) {
  const usage = record(value);
  const commonUrl = normalizeChinaProductUrl(usage.commonUrl);
  const purchaseUrl = normalizeChinaProductUrl(usage.purchaseUrl);
  const detailPageUrl = normalizeChinaProductUrl(usage.detailPageUrl);
  const purchasePrimary = purchaseUrl || (detailPageUrl ? "" : commonUrl);
  const purchaseAlternates = normalizeChinaProductLinks(usage.purchaseAlternates)
    .filter((url) => url !== purchasePrimary)
    .slice(0, MAX_CHINA_PRODUCT_LINKS - 1);
  return { commonUrl, purchaseUrl, detailPageUrl, purchaseAlternates };
}

function linkValue(value) {
  const entry = record(value);
  return entry.url ?? entry.href ?? entry.value ?? (typeof value === "string" ? value : "");
}

function legacyLinkValues(item) {
  const source = record(item);
  const detail = record(source.detailPageSource);
  const saved = Array.isArray(source.chinaProductLinks)
    ? source.chinaProductLinks.map(linkValue).filter((value) => text(value))
    : [];
  const candidates = saved.length ? saved : [
    source.primaryChinaProductLink,
    detail.primaryUrl,
    ...(Array.isArray(detail.urls) ? detail.urls : []),
  ].map(linkValue);
  // Historic placeholders are kept in the legacy record, but are not supplier URLs.
  return candidates.filter((value) => !/^(?:[xv]|[ㅁᄆ])$/i.test(text(value)));
}

export function readLegacyChinaLinkUsage(item) {
  // Reject invalid legacy data on migration rather than silently dropping a link.
  const links = [...new Set(legacyLinkValues(item).map(normalizeChinaProductUrl).filter(Boolean))];
  if (links.length > MAX_CHINA_PRODUCT_LINKS) {
    throw new Error("기존 중국 상품링크가 5개를 초과합니다.");
  }
  const [commonUrl = "", ...purchaseAlternates] = links;
  return { commonUrl, purchaseUrl: "", detailPageUrl: "", purchaseAlternates };
}

export function readChinaLinkUsage(item) {
  const usage = record(item).chinaLinkUsage;
  if (usage && usage === record(usage)) {
    return {
      commonUrl: text(usage.commonUrl),
      purchaseUrl: text(usage.purchaseUrl),
      detailPageUrl: text(usage.detailPageUrl),
      purchaseAlternates: Array.isArray(usage.purchaseAlternates)
        ? usage.purchaseAlternates.map(text).filter(Boolean)
        : [],
    };
  }
  const [commonUrl = "", ...purchaseAlternates] = [...new Set(
    legacyLinkValues(item).map(text).filter(Boolean),
  )].slice(0, MAX_CHINA_PRODUCT_LINKS);
  return { commonUrl, purchaseUrl: "", detailPageUrl: "", purchaseAlternates };
}

export function readChinaPurchaseLink(item) {
  const { commonUrl, purchaseUrl, detailPageUrl } = readChinaLinkUsage(item);
  return purchaseUrl || (detailPageUrl ? "" : commonUrl);
}

export function readChinaDetailPageLink(item) {
  const { commonUrl, purchaseUrl, detailPageUrl } = readChinaLinkUsage(item);
  return detailPageUrl || (purchaseUrl ? "" : commonUrl);
}

export function setChinaLinkUsageInput(usage, role, value) {
  const next = { ...usage, [role]: value };
  if (!usage.purchaseUrl.trim() && !usage.detailPageUrl.trim() && value.trim()) {
    const otherRole = role === "purchaseUrl" ? "detailPageUrl" : "purchaseUrl";
    next[otherRole] = usage.commonUrl;
  }
  return next;
}

export function chinaLinkUsagePatch(item, value) {
  const chinaLinkUsage = normalizeChinaLinkUsage(value);
  const purchaseUrl = readChinaPurchaseLink({ chinaLinkUsage });
  const detailUrl = readChinaDetailPageLink({ chinaLinkUsage });
  return {
    chinaLinkUsage,
    // Keep the old order metadata contract for downstream readers during rollout.
    chinaProductLinks: purchaseUrl ? [purchaseUrl, ...chinaLinkUsage.purchaseAlternates] : [],
    primaryChinaProductLink: purchaseUrl,
    detailPageSource: {
      ...record(record(item).detailPageSource),
      primaryUrl: detailUrl,
      urls: detailUrl ? [detailUrl] : [],
      pinnedIndex: detailUrl ? 0 : null,
      source: record(record(item).detailPageSource).source ?? "product_launch_tracker",
    },
  };
}

export function applyChinaLinkUsage(item, value, { now = new Date(), updatedBy = "승준" } = {}) {
  const patch = chinaLinkUsagePatch(item, value);
  const updatedAt = now.toISOString();
  return {
    ...record(item),
    ...patch,
    detailPageSource: { ...patch.detailPageSource, updatedAt },
    updatedAt,
    updatedBy,
  };
}
