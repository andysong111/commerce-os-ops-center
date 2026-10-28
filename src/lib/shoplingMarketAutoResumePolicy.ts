const EXPECTED_CHANNEL_COUNT = 6;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function rowSucceeded(row: UnknownRecord) {
  return (
    row.success === true ||
    text(row.status).toLowerCase() === "success" ||
    text(row.code) === "000"
  );
}

export function normalizeMarketAutoRunIds(value: unknown, limit = 250) {
  const input = Array.isArray(value) ? value : [];
  return [...new Set(input.map(text).filter((id) => id && id.length <= 180))]
    .sort()
    .slice(0, limit);
}

export function marketAutoRunIdSetsEqual(left: unknown, right: unknown) {
  const a = normalizeMarketAutoRunIds(left);
  const b = normalizeMarketAutoRunIds(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function marketAutoRunIdSetsOverlap(left: unknown, right: unknown) {
  const a = new Set(normalizeMarketAutoRunIds(left));
  return normalizeMarketAutoRunIds(right).some((value) => a.has(value));
}

export function verifiedMarketOnlyUploadJob(jobInput: unknown) {
  const job = record(jobInput);
  if (text(job.status) !== "success") return null;

  const result = record(job.result);
  const verification = record(result.readback_verification);
  if (verification.verified !== true) return null;
  if (Number(verification.expectedCount ?? 0) !== EXPECTED_CHANNEL_COUNT) return null;
  if (Number(verification.verifiedCount ?? 0) !== EXPECTED_CHANNEL_COUNT) return null;
  if (Number(verification.missingCount ?? 0) !== 0) return null;
  if (Number(result.success_count ?? 0) !== EXPECTED_CHANNEL_COUNT) return null;
  if (Number(result.failed_count ?? 0) !== 0) return null;

  const rows = array(result.rows)
    .map(record)
    .filter(rowSucceeded)
    .map((row) => ({
      goodsKey: text(row.goods_key || row.goodsKey),
      channelKey: text(row.channel_key || row.channelKey || row.channel),
    }))
    .filter((row) => /^\d{5,9}$/.test(row.goodsKey) && row.channelKey);
  const goodsKeys = [...new Set(rows.map((row) => row.goodsKey))];
  const channelKeys = [...new Set(rows.map((row) => row.channelKey))];
  if (
    rows.length !== EXPECTED_CHANNEL_COUNT ||
    goodsKeys.length !== EXPECTED_CHANNEL_COUNT ||
    channelKeys.length !== EXPECTED_CHANNEL_COUNT
  ) {
    return null;
  }

  const jobId = text(job.id);
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(jobId)) return null;
  return { jobId, goodsKeys };
}

export function marketOnlyLedgerSafety(
  goodsKeysInput: unknown,
  ledgerRowsInput: unknown,
) {
  const goodsKeys = [...new Set(array(goodsKeysInput).map(text).filter(Boolean))];
  const ledgerByKey = new Map(
    array(ledgerRowsInput)
      .map(record)
      .map((row) => [text(row.goods_key), row] as const)
      .filter(([goodsKey]) => goodsKey),
  );
  let pendingCount = 0;
  let completedCount = 0;
  let busyCount = 0;
  let blockedCount = 0;
  const blockedGoodsKeys: string[] = [];

  for (const goodsKey of goodsKeys) {
    const row = ledgerByKey.get(goodsKey);
    if (!row) {
      pendingCount += 1;
      continue;
    }
    const status = text(row.status);
    const marketStatus = text(row.market_status);
    if (
      [status, marketStatus].some((value) =>
        ["sent", "already_registered"].includes(value),
      )
    ) {
      completedCount += 1;
      continue;
    }
    if (status === "claimed" || marketStatus === "submit_armed") {
      busyCount += 1;
      blockedGoodsKeys.push(goodsKey);
      continue;
    }
    if (
      [status, marketStatus].some((value) =>
        ["confirm_needed", "failed", "legacy_ignored"].includes(value),
      )
    ) {
      blockedCount += 1;
      blockedGoodsKeys.push(goodsKey);
      continue;
    }
    pendingCount += 1;
  }

  return {
    safe: goodsKeys.length > 0 && busyCount === 0 && blockedCount === 0,
    allCompleted: goodsKeys.length > 0 && completedCount === goodsKeys.length,
    goodsKeyCount: goodsKeys.length,
    pendingCount,
    completedCount,
    busyCount,
    blockedCount,
    blockedGoodsKeys,
  };
}
