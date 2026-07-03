import { createEmptyCandidate, type SourcingCandidate } from "@/lib/sourcingEngine";

export type CandidateImportResult = {
  candidates: SourcingCandidate[];
  warnings: string[];
};

type RawCandidateRecord = Record<string, unknown>;

const urlRegex = /https?:\/\/[\w.-]*1688\.com\/[^\s"'<>]+/gi;
const imageRegex = /https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>]*)?/i;
const priceRegexes = [
  /(?:¥|￥)\s*(\d+(?:\.\d+)?)/i,
  /(?:cny|rmb)\s*(\d+(?:\.\d+)?)/i,
  /(?:单价|价格|price|价)\s*[:：]?\s*(\d+(?:\.\d+)?)/i,
  /(\d+(?:\.\d+)?)\s*(?:元|위안)/i,
];
const moqRegexes = [
  /(?:moq|起订量|起批量|起订|起批)\s*[:：]?\s*(\d+)/i,
  /(\d+)\s*(?:件|个|개)\s*(?:起订|起批|起)/i,
];
const shippingRegexes = [
  /(?:运费|快递|배송비|shipping)\s*[:：]?\s*(\d+(?:\.\d+)?)/i,
  /(?:运费|快递)\s*(?:¥|￥)?\s*(\d+(?:\.\d+)?)/i,
];

const urlKeys = ["url", "link", "1688", "1688url", "producturl", "상품url", "링크"];
const imageKeys = ["image", "imageurl", "img", "thumb", "thumbnail", "이미지", "이미지url"];
const titleCnKeys = ["titlecn", "title_cn", "title", "상품명", "중국어상품명", "제목"];
const titleKrKeys = ["titlekr", "title_kr", "koreantitle", "한국어상품명", "설명"];
const priceKeys = ["price", "unitprice", "unitpricecny", "unit_price_cny", "단가", "1688단가", "가격"];
const moqKeys = ["moq", "minimum", "min", "최소수량", "최소주문", "기본수량"];
const shippingKeys = ["shipping", "shippingcny", "china_shipping", "china_shipping_fee_cny", "중국배송비", "배송비"];
const optionKeys = ["options", "option", "옵션", "색상", "규격"];
const shopKeys = ["shop", "shopname", "shop_name", "supplier", "공급처", "상점"];
const notesKeys = ["notes", "note", "memo", "메모", "주의"];

export function parseCandidateImportText(rawText: string): CandidateImportResult {
  const text = rawText.trim();
  if (!text) {
    return { candidates: [], warnings: ["붙여넣은 후보 데이터가 없습니다."] };
  }

  const jsonResult = tryParseJson(text);
  if (jsonResult) return jsonResult;

  const tableResult = tryParseTable(text);
  if (tableResult.candidates.length > 0) return tableResult;

  return parseFreeText(text);
}

export function serializeCandidatesForTextarea(candidates: SourcingCandidate[]) {
  return candidates
    .map((candidate) =>
      [
        candidate.url,
        candidate.titleCn,
        candidate.titleKr,
        candidate.unitPriceCny,
        candidate.moq,
        candidate.chinaShippingFeeCny,
        candidate.optionsText,
        candidate.shopName,
        candidate.imageUrl,
        candidate.notes,
      ].join("\t"),
    )
    .join("\n");
}

function tryParseJson(text: string): CandidateImportResult | null {
  if (!text.startsWith("[") && !text.startsWith("{")) return null;

  try {
    const parsed = JSON.parse(text) as unknown;
    const records = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { candidates?: unknown }).candidates)
        ? ((parsed as { candidates: unknown[] }).candidates)
        : [parsed];

    const candidates = records
      .filter(isRecord)
      .map((record, index) => candidateFromRecord(record, index + 1))
      .filter((candidate) => candidate.url !== "");

    return finalizeCandidates(candidates, []);
  } catch {
    return null;
  }
}

function tryParseTable(text: string): CandidateImportResult {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (rows.length < 2) return { candidates: [], warnings: [] };

  const delimiter = detectDelimiter(rows[0]);
  if (!delimiter) return { candidates: [], warnings: [] };

  const headers = splitDelimitedLine(rows[0], delimiter).map(normalizeKey);
  const hasUrlHeader = headers.some((header) => urlKeys.includes(header));
  if (!hasUrlHeader) return { candidates: [], warnings: [] };

  const candidates = rows.slice(1).map((row, index) => {
    const values = splitDelimitedLine(row, delimiter);
    const record: RawCandidateRecord = {};
    headers.forEach((header, valueIndex) => {
      record[header] = values[valueIndex] ?? "";
    });
    return candidateFromRecord(record, index + 1);
  });

  return finalizeCandidates(candidates, []);
}

function parseFreeText(text: string): CandidateImportResult {
  const urls = [...text.matchAll(urlRegex)].map((match) => ({
    url: cleanUrl(match[0]),
    index: match.index ?? 0,
  }));

  if (urls.length === 0) {
    return {
      candidates: [],
      warnings: ["1688 상품 URL을 찾지 못했습니다. detail.1688.com 링크가 포함되어야 합니다."],
    };
  }

  const candidates = urls.map((entry, index) => {
    const nextIndex = urls[index + 1]?.index ?? text.length;
    const block = text.slice(entry.index, nextIndex);
    const candidate = createEmptyCandidate(index + 1);
    const lines = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    candidate.url = entry.url;
    candidate.imageUrl = extractImageUrl(block);
    candidate.titleCn = extractTitle(lines, entry.url);
    candidate.titleKr = "";
    candidate.unitPriceCny = extractNumber(block, priceRegexes);
    candidate.moq = extractInteger(block, moqRegexes) || 1;
    candidate.chinaShippingFeeCny = extractNumber(block, shippingRegexes);
    candidate.optionsText = extractOptions(lines);
    candidate.shopName = extractShopName(lines);
    candidate.notes = "";

    return candidate;
  });

  return finalizeCandidates(candidates, []);
}

function candidateFromRecord(record: RawCandidateRecord, index: number): SourcingCandidate {
  const candidate = createEmptyCandidate(index);
  candidate.url = cleanUrl(readString(record, urlKeys));
  candidate.imageUrl = readString(record, imageKeys);
  candidate.titleCn = readString(record, titleCnKeys);
  candidate.titleKr = readString(record, titleKrKeys);
  candidate.unitPriceCny = readNumber(record, priceKeys);
  candidate.moq = readInteger(record, moqKeys) || 1;
  candidate.chinaShippingFeeCny = readNumber(record, shippingKeys);
  candidate.optionsText = readString(record, optionKeys);
  candidate.shopName = readString(record, shopKeys);
  candidate.notes = readString(record, notesKeys);
  return candidate;
}

function finalizeCandidates(
  candidates: SourcingCandidate[],
  warnings: string[],
): CandidateImportResult {
  const seen = new Set<string>();
  const normalized: SourcingCandidate[] = [];

  for (const candidate of candidates) {
    const url = cleanUrl(candidate.url);
    if (!url) continue;
    if (seen.has(url)) {
      warnings.push(`중복 URL 제거: ${url}`);
      continue;
    }

    seen.add(url);
    normalized.push({
      ...candidate,
      id: `import-candidate-${normalized.length + 1}`,
      url,
      moq: Math.max(1, Math.floor(candidate.moq || 1)),
      unitPriceCny: Math.max(0, candidate.unitPriceCny || 0),
      chinaShippingFeeCny: Math.max(0, candidate.chinaShippingFeeCny || 0),
    });
  }

  if (normalized.length < 3) {
    warnings.push("주문 가능 판단에는 1688 후보 3개 이상이 권장됩니다.");
  }

  for (const candidate of normalized) {
    if (candidate.unitPriceCny <= 0) {
      warnings.push(`${candidate.url} 단가가 비어 있습니다.`);
    }
  }

  return { candidates: normalized, warnings };
}

function detectDelimiter(header: string) {
  if (header.includes("\t")) return "\t";
  if (header.includes(",")) return ",";
  return null;
}

function splitDelimitedLine(line: string, delimiter: string) {
  if (delimiter === "\t") return line.split("\t").map((value) => value.trim());

  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  values.push(current.trim());
  return values;
}

function readString(record: RawCandidateRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key] ?? record[normalizeKey(key)];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function readNumber(record: RawCandidateRecord, keys: string[]) {
  const rawValue = readString(record, keys);
  const match = rawValue.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function readInteger(record: RawCandidateRecord, keys: string[]) {
  return Math.floor(readNumber(record, keys));
}

function extractNumber(text: string, regexes: RegExp[]) {
  for (const regex of regexes) {
    const match = text.match(regex);
    if (match?.[1]) return Number(match[1]);
  }
  return 0;
}

function extractInteger(text: string, regexes: RegExp[]) {
  return Math.floor(extractNumber(text, regexes));
}

function extractImageUrl(text: string) {
  return text.match(imageRegex)?.[0] ?? "";
}

function extractTitle(lines: string[], url: string) {
  const candidates = lines.filter((line) => {
    const normalized = line.toLowerCase();
    if (normalized.includes(url.toLowerCase())) return false;
    if (urlRegex.test(line)) return false;
    urlRegex.lastIndex = 0;
    if (imageRegex.test(line)) return false;
    if (priceRegexes.some((regex) => regex.test(line))) return false;
    if (moqRegexes.some((regex) => regex.test(line))) return false;
    return line.length >= 4;
  });

  return candidates[0] ?? "";
}

function extractOptions(lines: string[]) {
  const optionLine = lines.find((line) => /(?:옵션|색상|规格|颜色|款式|型号)[:：]/i.test(line));
  if (!optionLine) return "";
  return optionLine.replace(/^(?:옵션|색상|规格|颜色|款式|型号)[:：]\s*/i, "").trim();
}

function extractShopName(lines: string[]) {
  const shopLine = lines.find((line) => /(?:공급처|상점|店铺|厂家|工厂)[:：]/i.test(line));
  if (!shopLine) return "";
  return shopLine.replace(/^(?:공급처|상점|店铺|厂家|工厂)[:：]\s*/i, "").trim();
}

function cleanUrl(url: string) {
  return url.trim().replace(/[),.;，。]+$/g, "");
}

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[\s_\-().]/g, "");
}

function isRecord(value: unknown): value is RawCandidateRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
