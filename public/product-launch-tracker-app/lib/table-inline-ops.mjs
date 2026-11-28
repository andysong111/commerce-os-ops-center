export const TABLE_COLUMN_DEFINITIONS = [
  { key: "select", label: "선택", movable: false },
  { key: "workBatch", label: "작업 묶음" },
  { key: "barcode", label: "기준 바코드" },
  { key: "modelNumber", label: "모델번호" },
  { key: "productName", label: "모델명" },
  { key: "shoplingCategory", label: "샵플링 표준 카테고리" },
  { key: "options", label: "옵션" },
  { key: "stock", label: "재고" },
  { key: "readiness", label: "등록 준비" },
  { key: "detailPage", label: "상세페이지" },
  { key: "shoplingUpload", label: "샵플링 업로드" },
  { key: "nextStage", label: "다음 작업" },
  { key: "manage", label: "관리" },
];

export const DEFAULT_TABLE_COLUMN_ORDER = TABLE_COLUMN_DEFINITIONS.map(
  (column) => column.key,
);

export function normalizeColumnOrder(value) {
  const source = Array.isArray(value) ? value.map(String) : [];
  const allowed = new Set(DEFAULT_TABLE_COLUMN_ORDER);
  const unique = [];
  for (const key of source) {
    if (allowed.has(key) && !unique.includes(key)) unique.push(key);
  }
  for (const key of DEFAULT_TABLE_COLUMN_ORDER) {
    if (!unique.includes(key)) unique.push(key);
  }
  const withoutSelect = unique.filter((key) => key !== "select");
  return ["select", ...withoutSelect];
}

export function alignTableRow(row, order) {
  const byKey = new Map([...row.children].map((cell) => [cell.dataset.columnKey, cell]));
  let index = 0;
  for (const key of order) {
    const cell = byKey.get(key);
    if (!cell) continue;
    const current = row.children[index++];
    if (cell !== current) row.insertBefore(cell, current ?? null);
  }
}

export function moveColumn(orderInput, sourceKey, targetKey) {
  const order = normalizeColumnOrder(orderInput);
  if (
    sourceKey === "select" ||
    sourceKey === targetKey ||
    !order.includes(sourceKey) ||
    !order.includes(targetKey)
  ) {
    return order;
  }
  const next = order.filter((key) => key !== sourceKey);
  const targetIndex = next.indexOf(targetKey);
  next.splice(targetIndex, 0, sourceKey);
  return normalizeColumnOrder(next);
}

export function frozenColumnKeys(orderInput, frozenThrough) {
  const order = normalizeColumnOrder(orderInput);
  if (!frozenThrough || !order.includes(frozenThrough)) return [];
  return order.slice(0, order.indexOf(frozenThrough) + 1);
}

export function buildFrozenColumnGeometry(measurements) {
  const source = Array.isArray(measurements) ? measurements : [];
  const geometry = [];
  let left = 0;
  for (const measurement of source) {
    const key = String(measurement?.key ?? "").trim();
    if (!key) continue;
    const widths = Array.isArray(measurement?.widths)
      ? measurement.widths
      : [measurement?.width];
    const width = Math.max(
      1,
      ...widths.map((value) => Math.ceil(Number(value) || 0)),
    );
    geometry.push({ key, left, width, right: left + width });
    left += width;
  }
  return geometry;
}

export function parseInlineOptionLabels(value, maximum = 50) {
  const labels = String(value ?? "")
    .split(/[,\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...new Set(labels)].slice(0, maximum);
}

export function applyInlineOptionLabels(existingValue, labelsValue) {
  const existing = Array.isArray(existingValue)
    ? existingValue.filter((entry) => entry && typeof entry === "object")
    : [];
  const labels = Array.isArray(labelsValue)
    ? labelsValue.map((entry) => String(entry).trim()).filter(Boolean)
    : parseInlineOptionLabels(labelsValue);
  return labels.map((saleOption, index) => ({
    ...(existing[index] ?? {}),
    id: String(existing[index]?.id ?? `inline-option-${index + 1}`),
    optionName: String(existing[index]?.optionName ?? "옵션").trim() || "옵션",
    saleOption,
    chinaOption: String(existing[index]?.chinaOption ?? "").trim(),
    barcode: String(existing[index]?.barcode ?? "").trim().toUpperCase(),
    baseSalePriceKrw: Math.max(
      0,
      Math.ceil(Number(existing[index]?.baseSalePriceKrw) || 0),
    ),
    unitCostKrw: Math.max(
      0,
      Math.ceil(Number(existing[index]?.unitCostKrw) || 0),
    ),
    sourceOrderItemId: existing[index]?.sourceOrderItemId ?? null,
  }));
}
