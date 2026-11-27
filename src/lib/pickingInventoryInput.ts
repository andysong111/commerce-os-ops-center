export type PickingObservation = {
  barcode: string;
  soldOut: boolean;
  quantity: number | null;
};
export const isPickingBcode = (code: string) => /^B[A-Z]{2}\d+-\d+$/.test(code);

export function pickingObservations(
  raw: unknown,
  items: { barcode: string; picked: boolean }[],
) {
  if (!Array.isArray(raw) || raw.length > items.length)
    throw new Error("재고 입력 항목을 확인해 주세요.");
  const known = new Map(items.map((item) => [item.barcode, item]));
  const seen = new Set<string>();
  const entries: PickingObservation[] = [];
  for (const row of raw) {
    if (
      !row ||
      typeof row.barcode !== "string" ||
      !isPickingBcode(row.barcode) ||
      !known.has(row.barcode) ||
      seen.has(row.barcode) ||
      typeof row.soldOut !== "boolean"
    )
      throw new Error("목록의 B코드와 입력한 항목이 일치하지 않습니다.");
    if (
      row.soldOut
        ? row.quantity !== null
        : !Number.isSafeInteger(row.quantity) ||
          row.quantity < 0 ||
          row.quantity > 1_000_000
    )
      throw new Error("남은 수량은 0~1,000,000 사이의 정수로 입력해 주세요.");
    if (row.soldOut && known.get(row.barcode)?.picked)
      throw new Error(
        row.barcode + "의 피킹 체크와 재고없음 표시를 확인해 주세요.",
      );
    entries.push({
      barcode: row.barcode,
      soldOut: row.soldOut,
      quantity: row.quantity,
    });
    seen.add(row.barcode);
  }
  const unavailable = new Set(
    entries.filter((e) => e.soldOut).map((e) => e.barcode),
  );
  const unchecked = items.filter(
    (item) => !item.picked && !unavailable.has(item.barcode),
  );
  if (unchecked.length)
    throw new Error(
      unchecked[0].barcode +
        " 등 미확인 " +
        unchecked.length +
        "개 품목을 체크해 주세요.",
    );
  return entries.sort((a, b) => a.barcode.localeCompare(b.barcode, "en"));
}
