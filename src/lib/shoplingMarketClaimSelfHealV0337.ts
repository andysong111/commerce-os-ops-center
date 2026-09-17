export const SAFE_PRE_SUBMIT_STALE_MS_V0337 = 15 * 60 * 1000;

export const SHOPLING_MARKET_CHANNELS_V0337: Record<string, readonly [string, string]> = {
  wholesale1: ["DM1", "도매1"],
  wholesale2: ["DM2", "도매2"],
  wholesale3: ["DM3", "도매3"],
  wholesale4: ["DM4", "도매4"],
  retail1: ["SM1", "소매1"],
  retail2: ["SM2", "소매2"],
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function timestampMs(value: unknown) {
  const raw = text(value);
  if (!raw) return Number.NaN;
  return new Date(raw).getTime();
}

export function isSafeStalePreSubmitClaimV0337(
  raw: unknown,
  nowMs = Date.now(),
) {
  const row = record(raw);
  if (text(row.status) !== "claimed" || text(row.market_status) !== "pending") return false;
  if (text(row.submit_armed_at)) return false;
  const claimedAt = timestampMs(row.claimed_at || row.updated_at);
  if (!Number.isFinite(claimedAt)) return false;
  const age = nowMs - claimedAt;
  return age >= SAFE_PRE_SUBMIT_STALE_MS_V0337 && age >= 0;
}

export function buildMissingLedgerRowsV0337(input: {
  ownerId: string;
  launchItemId: string;
  modelNumber?: string;
  uploadRows: unknown[];
  registryRows: unknown[];
  existingGoodsKeys?: string[];
  nowIso?: string;
}) {
  const ownerId = text(input.ownerId);
  const launchItemId = text(input.launchItemId);
  const modelNumber = text(input.modelNumber);
  const nowIso = text(input.nowIso) || new Date().toISOString();
  const uploadRows = Array.isArray(input.uploadRows) ? input.uploadRows.map(record) : [];
  const registryRows = Array.isArray(input.registryRows) ? input.registryRows.map(record) : [];
  const existing = new Set((Array.isArray(input.existingGoodsKeys) ? input.existingGoodsKeys : []).map(text).filter(Boolean));

  if (!ownerId || !launchItemId || uploadRows.length !== 6) {
    return { ok: false as const, error: "backfill_input_invalid", rows: [] as Record<string, unknown>[] };
  }

  const registryByGoods = new Map<string, Record<string, unknown>>();
  for (const row of registryRows) {
    const goodsKey = text(row.goods_key);
    if (!goodsKey || registryByGoods.has(goodsKey)) {
      return { ok: false as const, error: "backfill_registry_identity_ambiguous", rows: [] as Record<string, unknown>[] };
    }
    registryByGoods.set(goodsKey, row);
  }

  const output: Record<string, unknown>[] = [];
  const uploadGoods = new Set<string>();
  const uploadChannels = new Set<string>();

  for (const upload of uploadRows) {
    const goodsKey = text(upload.goods_key || upload.goodsKey);
    const channelKey = text(upload.channel_key);
    const ptnGoodsCd = text(upload.ptn_goods_cd);
    const mapping = SHOPLING_MARKET_CHANNELS_V0337[channelKey];
    if (!mapping || !/^\d{5,9}$/.test(goodsKey) || !ptnGoodsCd.startsWith(`${mapping[0]}_`)) {
      return { ok: false as const, error: "backfill_upload_identity_invalid", rows: [] as Record<string, unknown>[] };
    }
    if (uploadGoods.has(goodsKey) || uploadChannels.has(channelKey)) {
      return { ok: false as const, error: "backfill_upload_identity_duplicate", rows: [] as Record<string, unknown>[] };
    }
    uploadGoods.add(goodsKey);
    uploadChannels.add(channelKey);

    const registry = registryByGoods.get(goodsKey);
    if (!registry) {
      return { ok: false as const, error: "backfill_registry_incomplete", rows: [] as Record<string, unknown>[] };
    }
    const registryModel = text(registry.model_number);
    const registrySearchPrefix = text(registry.search_prefix).replace(/_+$/, "");
    if (
      text(registry.launch_item_id) !== launchItemId
      || text(registry.product_group_key) !== channelKey
      || text(registry.ptn_goods_cd) !== ptnGoodsCd
      || text(registry.shopling_status) !== "success"
      || registrySearchPrefix !== mapping[0]
      || (modelNumber && registryModel && registryModel !== modelNumber)
    ) {
      return { ok: false as const, error: "backfill_registry_identity_conflict", rows: [] as Record<string, unknown>[] };
    }

    if (existing.has(goodsKey)) continue;
    output.push({
      owner_id: ownerId,
      goods_key: goodsKey,
      launch_item_id: launchItemId,
      model_number: registryModel || modelNumber,
      product_group_key: channelKey,
      profile: mapping[1],
      ptn_goods_cd: ptnGoodsCd,
      search_prefix: mapping[0],
      registry_registered_at: text(registry.registered_at) || null,
      status: "queued",
      claim_run_id: "",
      claimed_at: null,
      title_status: "ok",
      market_status: "pending",
      submit_armed_at: null,
      reason_code: "auto_ledger_backfill_from_registry_v0337",
      message: "Shopling 등록 성공 레지스트리에서 누락된 마켓전송 원장을 자동 복구했습니다.",
      completed_at: null,
      updated_at: nowIso,
    });
  }

  if (uploadGoods.size !== 6 || uploadChannels.size !== 6) {
    return { ok: false as const, error: "backfill_upload_set_invalid", rows: [] as Record<string, unknown>[] };
  }

  return { ok: true as const, error: "", rows: output };
}
