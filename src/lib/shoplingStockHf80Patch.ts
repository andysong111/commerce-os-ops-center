type Hf80TransmissionRow = {
  goodsKey?: unknown;
  optionCount?: unknown;
  sequence?: unknown;
  transmissionKind?: unknown;
  effectiveProductKind?: unknown;
  [key: string]: unknown;
};

export type Hf80TransmissionGroup = {
  sequence: number;
  transmissionKind: "OPTION_SEND" | "PRODUCT_SALE_STATUS_SEND";
  effectiveProductKind: "OPTION" | "SINGLE";
  goodsKeys: string[];
  optionCounts: Record<string, number>;
};

const KIND_ORDER = ["PRODUCT_SALE_STATUS_SEND", "OPTION_SEND"] as const;

function normalizedRow(row: Hf80TransmissionRow) {
  const goodsKey = String(row.goodsKey ?? "").trim();
  const transmissionKind = String(row.transmissionKind ?? "")
    .trim()
    .toUpperCase();
  const effectiveProductKind =
    transmissionKind === "OPTION_SEND"
      ? "OPTION"
      : transmissionKind === "PRODUCT_SALE_STATUS_SEND"
        ? "SINGLE"
        : "";
  const declaredProductKind = String(row.effectiveProductKind ?? "")
    .trim()
    .toUpperCase();
  const optionCount = Number(row.optionCount ?? 0);
  const sequence = Number(row.sequence ?? 1);
  if (
    !/^\d+$/.test(goodsKey) ||
    !effectiveProductKind ||
    declaredProductKind !== effectiveProductKind ||
    !Number.isInteger(optionCount) ||
    optionCount < 1 ||
    !Number.isInteger(sequence) ||
    sequence < 1
  ) {
    throw new Error(`SHOPLING_HF80_API_PLAN_INVALID:${goodsKey || "UNKNOWN"}`);
  }
  return {
    ...row,
    goodsKey,
    transmissionKind: transmissionKind as Hf80TransmissionGroup["transmissionKind"],
    effectiveProductKind: effectiveProductKind as Hf80TransmissionGroup["effectiveProductKind"],
    optionCount,
    sequence,
  };
}

export function buildHf80TransmissionGroups(
  rows: Hf80TransmissionRow[],
  goodsKeys: string[],
) {
  const expected = goodsKeys.map((value) => String(value ?? "").trim());
  if (
    !expected.length ||
    new Set(expected).size !== expected.length ||
    expected.some((goodsKey) => !/^\d+$/.test(goodsKey))
  ) {
    throw new Error("SHOPLING_HF80_GOODS_KEY_SET_INVALID");
  }
  const expectedSet = new Set(expected);
  const normalizedRows = rows.map(normalizedRow);
  const stepGoodsKeys = new Set<string>();
  const sequencesByGoodsKey = new Map<string, number[]>();
  for (const row of normalizedRows) {
    if (!expectedSet.has(row.goodsKey)) {
      throw new Error(`SHOPLING_HF80_GOODS_KEY_SET_MISMATCH:${row.goodsKey}`);
    }
    const stepKey = `${row.sequence}:${row.goodsKey}`;
    if (stepGoodsKeys.has(stepKey)) {
      throw new Error(`SHOPLING_HF80_DUPLICATE_STEP:${stepKey}`);
    }
    stepGoodsKeys.add(stepKey);
    const sequences = sequencesByGoodsKey.get(row.goodsKey) ?? [];
    sequences.push(row.sequence);
    sequencesByGoodsKey.set(row.goodsKey, sequences);
  }
  for (const goodsKey of expected) {
    const sequences = (sequencesByGoodsKey.get(goodsKey) ?? []).sort(
      (left, right) => left - right,
    );
    if (
      !sequences.length ||
      sequences.some((sequence, index) => sequence !== index + 1)
    ) {
      throw new Error(`SHOPLING_HF80_STEP_SEQUENCE_INVALID:${goodsKey}`);
    }
  }

  const sequenceValues = [...new Set(normalizedRows.map((row) => row.sequence))]
    .sort((left, right) => left - right);
  const groups: Hf80TransmissionGroup[] = [];
  for (const sequence of sequenceValues) {
    for (const transmissionKind of KIND_ORDER) {
      const groupRows = normalizedRows.filter(
        (row) =>
          row.sequence === sequence &&
          row.transmissionKind === transmissionKind,
      );
      if (!groupRows.length) continue;
      groups.push({
        sequence,
        transmissionKind,
        effectiveProductKind:
          transmissionKind === "OPTION_SEND" ? "OPTION" : "SINGLE",
        goodsKeys: groupRows.map((row) => row.goodsKey),
        optionCounts: Object.fromEntries(
          groupRows.map((row) => [row.goodsKey, row.optionCount]),
        ),
      });
    }
  }
  if (!groups.length) throw new Error("SHOPLING_HF80_GROUP_EMPTY");
  return { rows: normalizedRows, groups };
}

const NORMALIZE_PLAN_HF80 = String.raw`  function normalizePlanV092(input) {
    const job = input && typeof input === "object" ? { ...input } : {};
    const jobId = norm(job.jobId);
    const barcode = norm(job.barcode).toUpperCase().replace(/\s+/g, "");
    const desiredStatus = norm(job.desiredStatus).toUpperCase();
    const logicalProductKind = norm(job.logicalProductKind || job.productKind).toUpperCase();
    const goodsKeys = Array.isArray(job.goodsKeys) ? job.goodsKeys.map(norm) : [];
    const rows = Array.isArray(job.stockStateTransmissions) ? job.stockStateTransmissions : [];
    const receipts = Array.isArray(job.stockStateApiEvidence) ? job.stockStateApiEvidence : [];
    if (!jobId) return { ok: false, code: "STOCK_SYNC_JOB_ID_REQUIRED", message: "작업 ID가 없습니다." };
    if (!/^B[A-Z]{1,2}\d+-\d+$/.test(barcode)) return { ok: false, code: "STOCK_SYNC_BARCODE_INVALID", message: "B코드 형식이 올바르지 않습니다." };
    if (!["OPTION", "SINGLE"].includes(logicalProductKind)) return { ok: false, code: "STOCK_SYNC_PRODUCT_KIND_INVALID", message: "상품형태가 올바르지 않습니다." };
    if (!["SOLD_OUT", "ON_SALE"].includes(desiredStatus)) return { ok: false, code: "STOCK_SYNC_DESIRED_STATUS_INVALID", message: "목표상태가 올바르지 않습니다." };
    const goodsKeySet = new Set(goodsKeys);
    if (!goodsKeys.length || goodsKeySet.size !== goodsKeys.length || receipts.length !== goodsKeys.length || rows.length < goodsKeys.length) {
      return { ok: false, code: "SHOPLING_HF80_API_PLAN_COUNT_MISMATCH", message: "API 검증 goods key·단계별 전송계획·영수증 수가 일치하지 않습니다." };
    }

    const normalizedRows = [];
    const stepGoodsKeys = new Set();
    const sequencesByGoodsKey = new Map();
    for (const row of rows) {
      const goodsKey = norm(row?.goodsKey);
      const transmissionKind = norm(row?.transmissionKind).toUpperCase();
      const effectiveProductKind = transmissionKind === "OPTION_SEND" ? "OPTION" : transmissionKind === "PRODUCT_SALE_STATUS_SEND" ? "SINGLE" : "";
      const declaredProductKind = norm(row?.effectiveProductKind).toUpperCase();
      const optionCount = Number(row?.optionCount || 0);
      const sequence = Number(row?.sequence || 1);
      if (!/^\d+$/.test(goodsKey) || !goodsKeySet.has(goodsKey) || !effectiveProductKind || declaredProductKind !== effectiveProductKind || !Number.isInteger(optionCount) || optionCount < 1 || !Number.isInteger(sequence) || sequence < 1) {
        return { ok: false, code: "SHOPLING_HF80_API_PLAN_INVALID", message: "goods key " + (goodsKey || "미확인") + "의 단계별 API 전송계획이 유효하지 않습니다." };
      }
      const stepKey = String(sequence) + ":" + goodsKey;
      if (stepGoodsKeys.has(stepKey)) {
        return { ok: false, code: "SHOPLING_HF80_DUPLICATE_STEP", message: "goods key " + goodsKey + "의 같은 단계가 중복되었습니다." };
      }
      stepGoodsKeys.add(stepKey);
      const sequences = sequencesByGoodsKey.get(goodsKey) || [];
      sequences.push(sequence);
      sequencesByGoodsKey.set(goodsKey, sequences);
      normalizedRows.push({ ...row, goodsKey, transmissionKind, effectiveProductKind, optionCount, sequence });
    }
    for (const goodsKey of goodsKeys) {
      const sequences = (sequencesByGoodsKey.get(goodsKey) || []).sort((left, right) => left - right);
      if (!sequences.length || sequences.some((sequence, index) => sequence !== index + 1)) {
        return { ok: false, code: "SHOPLING_HF80_STEP_SEQUENCE_INVALID", message: "goods key " + goodsKey + "의 전송 단계가 연속적이지 않습니다." };
      }
    }
    const receiptKeys = new Set(receipts.map((row) => norm(row?.matchedGoodsKey)));
    if (receiptKeys.size !== goodsKeys.length || goodsKeys.some((goodsKey) => !receiptKeys.has(goodsKey))) {
      return { ok: false, code: "SHOPLING_HF80_RECEIPT_SET_MISMATCH", message: "API 재조회 영수증과 전송 대상 goods key가 일치하지 않습니다." };
    }

    const groups = [];
    const sequenceValues = [...new Set(normalizedRows.map((row) => row.sequence))].sort((left, right) => left - right);
    for (const sequence of sequenceValues) {
      for (const transmissionKind of ["PRODUCT_SALE_STATUS_SEND", "OPTION_SEND"]) {
        const groupRows = normalizedRows.filter((row) => row.sequence === sequence && row.transmissionKind === transmissionKind);
        if (!groupRows.length) continue;
        groups.push({
          sequence,
          transmissionKind,
          effectiveProductKind: transmissionKind === "OPTION_SEND" ? "OPTION" : "SINGLE",
          goodsKeys: groupRows.map((row) => row.goodsKey),
          optionCounts: Object.fromEntries(groupRows.map((row) => [row.goodsKey, row.optionCount])),
        });
      }
    }
    if (!groups.length) return { ok: false, code: "SHOPLING_HF80_GROUP_EMPTY", message: "Shopling 전송 묶음을 만들지 못했습니다." };

    delete job.stockStateTransmissions;
    const firstGroup = groups[0];
    return {
      ok: true,
      job: {
        ...job,
        jobId,
        barcode,
        desiredStatus,
        logicalProductKind,
        productKind: firstGroup.effectiveProductKind,
        goodsKeys: [...firstGroup.goodsKeys],
        stockStateApiApplied: true,
        optionApiApplied: firstGroup.effectiveProductKind === "OPTION",
        productStatusApiApplied: firstGroup.effectiveProductKind === "SINGLE",
        stockStateAllGoodsKeysHf72: [...goodsKeys],
        stockStateTransmissionPlanHf72: normalizedRows,
        stockStateTransmissionGroupsHf72: groups,
        stockStateApiEvidenceAllHf72: receipts,
        stockStateBatchMaxHf72: BATCH_MAX_V092,
      },
      groups,
    };
  }`;

export function patchHf80BackgroundSource(source: string) {
  const startMarker = "  function normalizePlanV092(input) {";
  const endMarker = "  function isGroupedJobV092(active) {";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error("shopling_stock_hf80_normalizer_anchor_missing");
  }
  if (source.indexOf(startMarker, start + startMarker.length) >= 0) {
    throw new Error("shopling_stock_hf80_normalizer_anchor_not_unique");
  }
  return `${source.slice(0, start)}${NORMALIZE_PLAN_HF80}\r\n\r\n${source.slice(end)}`;
}
