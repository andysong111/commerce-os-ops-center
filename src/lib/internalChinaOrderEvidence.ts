export type InternalChinaOrderEvidenceLine = {
  barcode?: unknown;
  unitPriceCny?: unknown;
  supplierLink?: unknown;
  chinaOption?: unknown;
  orderNumber?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function barcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "") || "품목";
}

function positivePrice(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function validHttpUrl(value: unknown) {
  const candidate = text(value);
  if (!candidate) return false;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function internalChinaOrderEvidenceIssues(
  lines: readonly InternalChinaOrderEvidenceLine[],
) {
  const issues: string[] = [];
  for (const line of lines) {
    const code = barcode(line.barcode);
    if (!positivePrice(line.unitPriceCny)) issues.push(`${code} 위안단가`);
    if (!validHttpUrl(line.supplierLink)) {
      issues.push(`${code} 모델 1번 1688 링크`);
    }
    if (!text(line.chinaOption)) issues.push(`${code} 중국옵션`);
    if (!text(line.orderNumber)) issues.push(`${code} 1688 주문번호`);
  }
  return issues;
}
