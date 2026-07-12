export type EditTableColumnId =
  | "rowNo"
  | "image"
  | "itemName"
  | "optionText"
  | "quantity"
  | "unitPrice"
  | "hsCode"
  | "detailUrl"
  | "imageSettings"
  | "orderNo"
  | "trackingNo"
  | "lookupText"
  | "barcode"
  | "matchStatus"
  | "matchedModelNo"
  | "matchedModelName"
  | "memo"
  | "bundleUnit"
  | "labelPrintCount";

export type EditTableColumn = {
  id: EditTableColumnId;
  label: string;
  width: number;
};

export const EDIT_TABLE_PINNED_COLUMNS_STORAGE_KEY =
  "commerce-os:freight-edit-table-pinned-columns:v1";
export const MAX_PINNED_EDIT_TABLE_COLUMNS = 5;
export const DEFAULT_PINNED_EDIT_TABLE_COLUMN_IDS: EditTableColumnId[] = [
  "image",
  "itemName",
];

export const EDIT_TABLE_COLUMNS: EditTableColumn[] = [
  { id: "rowNo", label: "순번", width: 88 },
  { id: "image", label: "이미지", width: 88 },
  { id: "itemName", label: "품목", width: 200 },
  { id: "optionText", label: "옵션", width: 248 },
  { id: "quantity", label: "수량", width: 120 },
  { id: "unitPrice", label: "단가", width: 120 },
  { id: "hsCode", label: "HS CODE", width: 152 },
  { id: "detailUrl", label: "상세URL", width: 280 },
  { id: "imageSettings", label: "이미지 설정", width: 312 },
  { id: "orderNo", label: "오픈마켓 주문번호", width: 216 },
  { id: "trackingNo", label: "트래킹번호", width: 184 },
  { id: "lookupText", label: "모델번호/모델명 입력", width: 232 },
  { id: "barcode", label: "바코드", width: 200 },
  { id: "matchStatus", label: "매칭상태", width: 176 },
  { id: "matchedModelNo", label: "모델번호", width: 152 },
  { id: "matchedModelName", label: "모델명", width: 184 },
  { id: "memo", label: "작업메모", width: 264 },
  { id: "bundleUnit", label: "소분단위", width: 136 },
  { id: "labelPrintCount", label: "바코드 출력수량", width: 176 },
];

const COLUMN_ID_SET = new Set<EditTableColumnId>(
  EDIT_TABLE_COLUMNS.map((column) => column.id),
);

export const EDIT_TABLE_TOTAL_WIDTH = EDIT_TABLE_COLUMNS.reduce(
  (sum, column) => sum + column.width,
  0,
);

export function isEditTableColumnId(
  value: unknown,
): value is EditTableColumnId {
  return (
    typeof value === "string" && COLUMN_ID_SET.has(value as EditTableColumnId)
  );
}

export function normalizePinnedColumnIds(value: unknown): EditTableColumnId[] {
  if (!Array.isArray(value)) return [...DEFAULT_PINNED_EDIT_TABLE_COLUMN_IDS];

  const normalized: EditTableColumnId[] = [];
  for (const id of value) {
    if (
      isEditTableColumnId(id) &&
      !normalized.includes(id) &&
      normalized.length < MAX_PINNED_EDIT_TABLE_COLUMNS
    ) {
      normalized.push(id);
    }
  }
  return normalized;
}

export function getOrderedPinnedColumns(
  pinnedColumnIds: EditTableColumnId[],
): EditTableColumn[] {
  const pinnedSet = new Set(pinnedColumnIds);
  return EDIT_TABLE_COLUMNS.filter((column) => pinnedSet.has(column.id));
}

export function getPinnedColumnOffset(
  columnId: EditTableColumnId,
  pinnedColumnIds: EditTableColumnId[],
): number | undefined {
  const orderedPinnedColumns = getOrderedPinnedColumns(pinnedColumnIds);
  const columnIndex = orderedPinnedColumns.findIndex(
    (column) => column.id === columnId,
  );
  if (columnIndex === -1) return undefined;

  return orderedPinnedColumns
    .slice(0, columnIndex)
    .reduce((sum, column) => sum + column.width, 0);
}

export function isLastPinnedColumn(
  columnId: EditTableColumnId,
  pinnedColumnIds: EditTableColumnId[],
): boolean {
  const orderedPinnedColumns = getOrderedPinnedColumns(pinnedColumnIds);
  return orderedPinnedColumns.at(-1)?.id === columnId;
}

export function togglePinnedColumnId(
  pinnedColumnIds: EditTableColumnId[],
  columnId: EditTableColumnId,
): EditTableColumnId[] {
  if (pinnedColumnIds.includes(columnId)) {
    return pinnedColumnIds.filter((id) => id !== columnId);
  }
  if (pinnedColumnIds.length >= MAX_PINNED_EDIT_TABLE_COLUMNS) {
    return pinnedColumnIds;
  }
  return [...pinnedColumnIds, columnId];
}
