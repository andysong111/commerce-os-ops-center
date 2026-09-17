import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  SAFE_PRE_SUBMIT_STALE_MS_V0337,
  buildMissingLedgerRowsV0337,
  isSafeStalePreSubmitClaimV0337,
} from "../src/lib/shoplingMarketClaimSelfHealV0337.ts";

const NOW = Date.parse("2026-09-17T07:30:00.000Z");

function staleRow(minutes, extra = {}) {
  return {
    status: "claimed",
    market_status: "pending",
    submit_armed_at: null,
    claimed_at: new Date(NOW - minutes * 60_000).toISOString(),
    updated_at: new Date(NOW - minutes * 60_000).toISOString(),
    ...extra,
  };
}

function fixtures() {
  const defs = [
    ["wholesale1", "DM1", "도매1", "122758"],
    ["wholesale2", "DM2", "도매2", "122759"],
    ["wholesale3", "DM3", "도매3", "122760"],
    ["wholesale4", "DM4", "도매4", "122761"],
    ["retail1", "SM1", "소매1", "122762"],
    ["retail2", "SM2", "소매2", "122763"],
  ];
  const uploadRows = defs.map(([channelKey, prefix, _label, goodsKey]) => ({
    status: "success",
    channel_key: channelKey,
    goods_key: goodsKey,
    ptn_goods_cd: `${prefix}_PLR9B896A4B88`,
  }));
  const registryRows = defs.map(([channelKey, prefix, label, goodsKey]) => ({
    goods_key: goodsKey,
    launch_item_id: "launch-2446-aaa471",
    model_number: "AAA471",
    product_group_key: channelKey,
    product_group_label: label,
    ptn_goods_cd: `${prefix}_PLR9B896A4B88`,
    search_prefix: `${prefix}_`,
    shopling_status: "success",
    registered_at: "2026-09-16T23:18:47.809Z",
  }));
  return { uploadRows, registryRows };
}

test("15분 이상 submit 이전 claimed/pending만 stale 복구 대상으로 본다", () => {
  assert.equal(SAFE_PRE_SUBMIT_STALE_MS_V0337, 15 * 60 * 1000);
  assert.equal(isSafeStalePreSubmitClaimV0337(staleRow(16), NOW), true);
  assert.equal(isSafeStalePreSubmitClaimV0337(staleRow(15), NOW), true);
  assert.equal(isSafeStalePreSubmitClaimV0337(staleRow(14), NOW), false);
});

test("submit_armed 경계를 지난 행은 stale여도 절대 자동 해제하지 않는다", () => {
  assert.equal(
    isSafeStalePreSubmitClaimV0337(staleRow(60, { submit_armed_at: "2026-09-17T06:40:00.000Z" }), NOW),
    false,
  );
});

test("confirm_needed/queued 등 claimed+pending 이외 상태는 자동 해제하지 않는다", () => {
  assert.equal(isSafeStalePreSubmitClaimV0337(staleRow(60, { status: "confirm_needed" }), NOW), false);
  assert.equal(isSafeStalePreSubmitClaimV0337(staleRow(60, { status: "queued" }), NOW), false);
  assert.equal(isSafeStalePreSubmitClaimV0337(staleRow(60, { market_status: "confirm_needed" }), NOW), false);
});

test("정확히 검증된 Shopling registry 6행에서 누락 ledger 6행을 만든다", () => {
  const { uploadRows, registryRows } = fixtures();
  const result = buildMissingLedgerRowsV0337({
    ownerId: "0c23a96b-1cda-44b6-9c08-1fa1c1b45a36",
    launchItemId: "launch-2446-aaa471",
    modelNumber: "AAA471",
    uploadRows,
    registryRows,
    existingGoodsKeys: [],
    nowIso: "2026-09-17T07:30:00.000Z",
  });
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 6);
  assert.deepEqual(result.rows.map((row) => row.goods_key), ["122758", "122759", "122760", "122761", "122762", "122763"]);
  assert.deepEqual(result.rows.map((row) => row.profile), ["도매1", "도매2", "도매3", "도매4", "소매1", "소매2"]);
  assert.deepEqual(result.rows.map((row) => row.search_prefix), ["DM1", "DM2", "DM3", "DM4", "SM1", "SM2"]);
  assert.ok(result.rows.every((row) => row.status === "queued" && row.market_status === "pending" && row.title_status === "ok"));
  assert.ok(result.rows.every((row) => row.submit_armed_at === null));
});

test("이미 ledger에 있는 goods_key는 건드리지 않고 실제 누락분만 만든다", () => {
  const { uploadRows, registryRows } = fixtures();
  const result = buildMissingLedgerRowsV0337({
    ownerId: "0c23a96b-1cda-44b6-9c08-1fa1c1b45a36",
    launchItemId: "launch-2446-aaa471",
    modelNumber: "AAA471",
    uploadRows,
    registryRows,
    existingGoodsKeys: ["122758", "122759", "122760", "122761"],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows.map((row) => row.goods_key), ["122762", "122763"]);
});

test("registry ptn_goods_cd가 업로드와 다르면 backfill을 차단한다", () => {
  const { uploadRows, registryRows } = fixtures();
  registryRows[2] = { ...registryRows[2], ptn_goods_cd: "DM3_WRONG" };
  const result = buildMissingLedgerRowsV0337({
    ownerId: "owner",
    launchItemId: "launch-2446-aaa471",
    modelNumber: "AAA471",
    uploadRows,
    registryRows,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "backfill_registry_identity_conflict");
});

test("registry 6행이 완전하지 않으면 backfill을 차단한다", () => {
  const { uploadRows, registryRows } = fixtures();
  const result = buildMissingLedgerRowsV0337({
    ownerId: "owner",
    launchItemId: "launch-2446-aaa471",
    modelNumber: "AAA471",
    uploadRows,
    registryRows: registryRows.slice(0, 5),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "backfill_registry_incomplete");
});

test("registry launch/model/channel identity 충돌도 backfill을 차단한다", () => {
  const { uploadRows, registryRows } = fixtures();
  const variants = [
    { launch_item_id: "wrong-launch" },
    { model_number: "AAA999" },
    { product_group_key: "retail2" },
    { shopling_status: "failed" },
  ];
  for (const patch of variants) {
    const mutated = registryRows.map((row, index) => index === 0 ? { ...row, ...patch } : row);
    const result = buildMissingLedgerRowsV0337({
      ownerId: "owner",
      launchItemId: "launch-2446-aaa471",
      modelNumber: "AAA471",
      uploadRows,
      registryRows: mutated,
    });
    assert.equal(result.ok, false);
  }
});

test("실제 v0337 claim route는 review 보호 뒤 stale release, registry backfill, guarded claim을 유지한다", () => {
  const source = fs.readFileSync("src/app/api/shopling-market-group-canary/v0337/claim/route.ts", "utf8");
  assert.match(source, /buildMissingLedgerRowsV0337/);
  assert.match(source, /shopling_product_group_registry/);
  assert.match(source, /auto_ledger_backfill_from_registry_v0337/);
  assert.match(source, /isSafeStalePreSubmitClaimV0337/);
  assert.match(source, /auto_stale_pre_submit_released_v0337/);
  assert.match(source, /\.eq\("claim_run_id", oldRunId\)/);
  assert.match(source, /\.is\("submit_armed_at", null\)/);
  assert.match(source, /safe_claim_claimed_v0337/);
  assert.ok(source.indexOf("ledger.filter(marketRowNeedsReview)") < source.indexOf("const stalePreSubmit = ledger.filter"));
});
