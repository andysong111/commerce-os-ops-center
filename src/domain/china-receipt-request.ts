const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BARCODE = /^[A-Z]{3}\d+-\d+$/;

export type ReceiptRequestLine = { barcode: string; quantity: number };
export type ReceiptReplaySnapshot = {
  receiptId?: unknown;
  draftId?: unknown;
  cycleMonth?: unknown;
  barcode?: unknown;
  receivedNow?: unknown;
  fullyReceived?: unknown;
  sourcing?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}
function barcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}
function quantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

export function validReceiptRequestId(value: unknown): string | null {
  const candidate = text(value).toLowerCase();
  if (!candidate) return null;
  if (!REQUEST_ID.test(candidate)) throw new Error("CHINA_RECEIPT_REQUEST_ID_INVALID");
  return candidate;
}

export function normalizeReceiptRequestLines(lines: ReceiptRequestLine[]) {
  const normalized = lines.map((line) => ({
    barcode: barcode(line.barcode),
    quantity: quantity(line.quantity),
  }));
  if (normalized.some((line) => !BARCODE.test(line.barcode) || line.quantity <= 0)) {
    throw new Error("CHINA_RECEIPT_REQUEST_LINES_INVALID");
  }
  const keys = new Set(normalized.map((line) => line.barcode));
  if (keys.size !== normalized.length) throw new Error("CHINA_RECEIPT_DUPLICATE_BARCODE");
  return normalized.sort((a, b) => a.barcode.localeCompare(b.barcode));
}

export function receiptRequestFingerprint(
  draftId: string,
  cycleMonth: string,
  lines: ReceiptRequestLine[],
) {
  return JSON.stringify({
    draftId: text(draftId),
    cycleMonth: text(cycleMonth),
    lines: normalizeReceiptRequestLines(lines),
  });
}

export function receiptRequestStorageKey(draftId: string, cycleMonth: string) {
  return "commerce-os:china-receipt-request:v1:" +
    encodeURIComponent(text(draftId)) + ":" + encodeURIComponent(text(cycleMonth));
}

export function summarizeStoredReceiptReplay(input: {
  requestId: string;
  draftId: string;
  cycleMonth: string;
  lines: ReceiptRequestLine[];
  snapshots: ReceiptReplaySnapshot[];
}) {
  const expected = normalizeReceiptRequestLines(input.lines);
  if (!input.snapshots.length) return null;
  if (input.snapshots.length !== expected.length) {
    throw new Error("CHINA_RECEIPT_REQUEST_REPLAY_CONFLICT");
  }
  const byBarcode = new Map(expected.map((line) => [line.barcode, line.quantity] as const));
  const seen = new Set<string>();
  let receivedNow = 0;
  let fullyReceivedCount = 0;
  let sourcedCount = 0;
  for (const raw of input.snapshots) {
    const code = barcode(raw.barcode);
    const received = quantity(raw.receivedNow);
    if (
      text(raw.receiptId).toLowerCase() !== input.requestId ||
      text(raw.draftId) !== input.draftId ||
      text(raw.cycleMonth) !== input.cycleMonth ||
      !byBarcode.has(code) ||
      byBarcode.get(code) !== received ||
      seen.has(code)
    ) {
      throw new Error("CHINA_RECEIPT_REQUEST_REPLAY_CONFLICT");
    }
    seen.add(code);
    receivedNow += received;
    if (raw.fullyReceived === true) fullyReceivedCount += 1;
    if (raw.sourcing && typeof raw.sourcing === "object" && !Array.isArray(raw.sourcing)) {
      sourcedCount += 1;
    }
  }
  if (seen.size !== expected.length) throw new Error("CHINA_RECEIPT_REQUEST_REPLAY_CONFLICT");
  return {
    receiptId: input.requestId,
    draftId: input.draftId,
    cycleMonth: input.cycleMonth,
    lineCount: expected.length,
    receivedNow,
    fullyReceivedCount,
    partiallyReceivedCount: expected.length - fullyReceivedCount,
    sourcedCount,
  };
}
