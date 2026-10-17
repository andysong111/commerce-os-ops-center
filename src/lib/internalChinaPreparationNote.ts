const PREPARATION_NOTE_PREFIX = "[1688 준비 제외]";

type PreparationLine = {
  chinaOption?: string;
  supplierLink?: string;
  note?: string;
};

function validHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function preparationNotePart(value: string) {
  return value
    .split(" · ")
    .map((part) => part.trim())
    .find((part) => part.startsWith(PREPARATION_NOTE_PREFIX)) || "";
}

export function activePreparationNote(line: PreparationLine) {
  const part = preparationNotePart(String(line.note || ""));
  if (!part) return "";

  const reason = part.slice(PREPARATION_NOTE_PREFIX.length).trim();
  if (reason === "중국 옵션 없음" && String(line.chinaOption || "").trim()) return "중국 옵션 재검증 필요";
  if (reason === "1688 링크 없음" && validHttpUrl(String(line.supplierLink || "").trim())) return "1688 링크 재검증 필요";
  return reason || "1688 장바구니 준비 제외";
}

export function removeResolvedPreparationNote(line: PreparationLine) {
  const note = String(line.note || "");
  if (!note.includes(PREPARATION_NOTE_PREFIX) || activePreparationNote(line)) return note;
  return note
    .split(" · ")
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith(PREPARATION_NOTE_PREFIX))
    .join(" · ");
}

