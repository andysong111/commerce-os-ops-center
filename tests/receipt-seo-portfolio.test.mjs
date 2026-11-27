import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReceiptSeoReport,
  receiptSeoPriceReady,
  receiptSeoRunId,
  receiptSeoSuccessors,
} from "../src/lib/receiptSeoPortfolio.ts";
import { SEO_LISTING_SHADOW_EXPECTED_PROFILES as profiles } from "../src/lib/seoListingLifecycleReconciliation.ts";

const now = new Date("2026-11-28T00:00:00Z"),
  draftId = "fast-purchase-draft:5cabcbeeffd1b884a074";
const line = (barcode, changes = {}) => ({
  draftId,
  barcode,
  quantity: 10,
  receiptId: "r1",
  receivedAt: 1,
  priceReady: true,
  saleReady: true,
  ...changes,
});
const card = (id, codes, changes = {}) => ({
  id,
  codes,
  name: "입고 상품",
  model: id,
  materialError: "",
  goodsKeys: [],
  priorUpload: false,
  ...changes,
});
const base = {
  owner: "owner-a",
  lines: [line("BCE6-1"), line("BCE6-2")],
  cards: [card("a", ["BCE6-1", "BCE6-2"])],
  jobs: [],
  lifecycle: [],
  ledger: [],
  registry: [],
  verifiedUploads: new Map(),
  isolatedIds: new Set(),
  marketSlots: 2,
  productSlots: 2,
  now,
};
const plan = (changes = {}) => buildReceiptSeoReport({ ...base, ...changes });
const goods = profiles.map((_, i) => String(10000 + i));
const ledger = profiles.map((profile, i) => ({
  launch_item_id: "a",
  profile,
  goods_key: goods[i],
  status: "sent",
  market_status: "sent",
}));
const job = {
  launch_item_id: "a",
  run_id: "seo-run-old-first",
  run_created_at: "2026-09-01",
  status: "ready",
  registration_status: "success",
  registration_job_id: "upload",
  registration_payload: { goodsKeys: goods },
};
const uploads = new Map([["upload", { itemId: "a", goodsKeys: goods }]]);
test("positive receipt options share one stable owner/card run across retries and restocks", () => {
  const r = plan();
  assert.equal(r.rows.length, 2);
  assert.equal(new Set(r.rows.map((x) => x.runId)).size, 1);
  assert.ok(r.rows.every((x) => x.state === "NEW" && x.quantity === 10));
  assert.equal(
    plan({
      lines: [
        line("BCE6-1", { draftId: "later", receiptId: "r2", quantity: 1 }),
      ],
    }).rows[0].runId,
    r.rows[0].runId,
  );
  assert.notEqual(r.rows[0].runId, receiptSeoRunId("other", "a"));
  assert.equal(plan({ lines: [] }).rows.length, 0);
});
test("missing or ambiguous cards remain in the durable intake and block sibling uploads", () => {
  const r = plan({
    lines: [...base.lines, line("BZA1-2")],
    cards: [...base.cards, card("b", ["BCE6-1"])],
  });
  assert.deepEqual(new Set(r.coveredItemIds), new Set(["a", "b"]));
  assert.ok(
    r.rows.every((x) => x.state === "HOLD" && x.rotation.includes("편입")),
  );
  assert.match(r.rows[0].reason, /여러/);
  assert.match(r.rows[1].reason, /모호/);
  assert.match(r.rows[2].reason, /없/);
});
test("missing material, price, original sale receipt, isolation and capacity hold only the affected products", () => {
  for (const changes of [
    { lines: [line("BCE6-1", { priceReady: false }), line("BCE6-2")] },
    { lines: [line("BCE6-1"), line("BCE6-2", { saleReady: false })] },
    {
      cards: [
        card("a", ["BCE6-1", "BCE6-2"], { materialError: "옵션 자료 부족" }),
      ],
    },
    { cards: [card("a", ["BCE6-1", "BCE6-2"], { excluded: "단종" })] },
    { marketSlots: 0 },
    { productSlots: 0 },
    { isolatedIds: new Set(["a"]) },
  ]) {
    const r = plan(changes);
    assert.ok(
      r.rows.every((x) => x.state === "HOLD" && x.rotation.includes("편입")),
    );
  }
  const r = plan({
    lines: [...base.lines, line("BBA1-1")],
    cards: [...base.cards, card("b", ["BBA1-1"])],
    marketSlots: 1,
  });
  assert.equal(
    new Set(r.rows.filter((x) => x.state === "NEW").map((x) => x.itemId)).size,
    1,
  );
});
test("latest receipt of another draft cannot authorize an old draft or an unverified sibling", () => {
  const r = plan({
    draftId,
    lines: [
      ...base.lines,
      line("BCE6-1", {
        draftId: "later",
        receiptId: "r2",
        receivedAt: 2,
        saleReady: false,
      }),
    ],
  });
  assert.ok(r.rows.every((x) => x.state === "HOLD"));
  assert.match(r.rows[0].reason, /최근 재입고/);
});
test("restock preserves protected exposure, prior work and distinct market receipts", () => {
  const life = profiles.map((market_account_key, i) => ({
    launch_item_id: "a",
    market_account_key,
    goods_key: goods[i],
    current_run_id: job.run_id,
    state: "PROTECTED",
    attempt_count: 2,
    sales_count_during_attempt: 3,
  }));
  const before = JSON.stringify(life);
  const r = plan({
    jobs: [job],
    ledger,
    lifecycle: life,
    verifiedUploads: uploads,
  });
  assert.ok(
    r.rows.every(
      (x) =>
        x.state === "DONE" &&
        x.markets === 6 &&
        x.rotation.includes("판매 보호"),
    ),
  );
  assert.equal(JSON.stringify(life), before);
  assert.equal(
    plan({
      jobs: [job],
      ledger: ledger.slice(0, 3),
      lifecycle: life,
      verifiedUploads: uploads,
    }).rows[0].state,
    "HOLD",
  );
  assert.equal(
    plan({ jobs: [{ ...job, archived_at: "2026-11-28" }] }).rows[0].state,
    "HOLD",
  );
});
test("partial registration reuses only the verified original upload and blocks claimed or uncertain receipts", () => {
  const params = {
    jobs: [job],
    ledger: ledger.slice(0, 3),
    verifiedUploads: uploads,
    productSlots: 0,
  };
  const r = plan(params).rows[0];
  assert.equal(r.state, "RESUME");
  assert.equal(r.runId, job.run_id);
  assert.equal(r.markets, 3);
  for (const change of [
    { verifiedUploads: new Map() },
    { marketSlots: 0 },
    { ledger: [...params.ledger, { ...ledger[3], status: "confirm_needed" }] },
    { ledger: [...params.ledger, { ...ledger[3], status: "claimed" }] },
    {
      verifiedUploads: new Map([["upload", { itemId: "b", goodsKeys: goods }]]),
    },
  ]) {
    assert.equal(plan({ ...params, ...change }).rows[0].state, "HOLD");
  }
  assert.equal(plan({ ledger: [ledger[0]] }).rows[0].state, "HOLD");
  assert.equal(
    plan({ jobs: [job], ledger: [{ ...ledger[0], launch_item_id: "other" }] })
      .rows[0].state,
    "HOLD",
  );
});
test("only completed cooldown with six original delete receipts can start a new round", () => {
  const life = profiles.map((market_account_key, i) => ({
    launch_item_id: "a",
    market_account_key,
    goods_key: goods[i],
    current_run_id: job.run_id,
    state: "COOLDOWN",
    attempt_count: 1,
    next_eligible_at: "2026-11-26",
    evidence: {
      previousListingDeleted: true,
      previousListingDeleteReadbackVerifiedAt: "2026-08-01",
    },
  }));
  const r = plan({ jobs: [job], lifecycle: life, ledger }).rows[0];
  assert.equal(r.state, "NEW");
  assert.notEqual(r.runId, receiptSeoRunId(base.owner, "a"));
  for (const patch of [
    { attempt_count: 3 },
    { next_eligible_at: "2027-01-01" },
    { evidence: { previousListingDeleted: true } },
  ]) {
    assert.equal(
      plan({
        jobs: [job],
        lifecycle: life.map((r, i) => (i ? r : { ...r, ...patch })),
        ledger,
      }).rows[0].state,
      "HOLD",
    );
  }
});
test("price proof is bound to all listings, receipt IDs, quantity and the selected draft", () => {
  const candidate = { goodsKey: "12345", options: [{ barcode: "BCE6-1" }] };
  const target = line("BCE6-1");
  const run = {
    id: "price",
    policy_version: "policy",
    source_snapshot: {
      draftId,
      candidates: [candidate],
      costs: [
        {
          barcode: target.barcode,
          draftId,
          receiptIds: ["r1"],
          quantity: 10,
          provenance: "CONFIRMED_RECEIPT_AND_CLOSED_COST",
        },
      ],
    },
  };
  const item = {
    id: "sku-price",
    goods_key: "12345",
    run_id: "price",
    candidate,
    state: "HELD",
    error_code: null,
    plan: {
      goodsKey: "12345",
      policy: "policy",
      writes: [],
      fingerprint: "hash",
    },
  };
  const ready = (i = item, t = target, keeps = new Set(), p = run) =>
    receiptSeoPriceReady(t, draftId, { run: p, items: [i] }, keeps);
  assert.ok(ready());
  assert.ok(!ready({ ...item, plan: null }));
  assert.ok(ready({ ...item, plan: null }, target, new Set([item.id])));
  assert.ok(!ready(item, { ...target, receiptId: "wrong" }));
  assert.ok(!ready(item, { ...target, quantity: 9 }));
  assert.ok(!ready({ ...item, state: "RESENDING" }));
  assert.ok(
    !ready({
      ...item,
      state: "TRANSMITTED",
      transmission: {
        result: "LEGACY_RELIST_RETIRED_AFTER_DELETION",
        finishedAt: "today",
      },
    }),
  );
  assert.ok(
    !ready(item, target, new Set(), {
      ...run,
      source_snapshot: {
        ...run.source_snapshot,
        candidates: [candidate, { ...candidate, goodsKey: "99999" }],
      },
    }),
  );
  assert.ok(
    !ready(item, target, new Set(), {
      ...run,
      source_snapshot: { ...run.source_snapshot, draftId: "other" },
    }),
  );
});

test("relisting follows the exact old rotation, new codes and readback without scheduling a third run", () => {
  const old = profiles.map((market_account_key, i) => ({
    owner_id: base.owner,
    launch_item_id: "a",
    market_account_key,
    goods_key: goods[i],
    current_run_id: job.run_id,
    state: "COOLDOWN",
    attempt_count: 1,
    next_eligible_at: "2026-11-26",
    evidence: {
      previousListingDeleted: true,
      previousListingDeleteReadbackVerifiedAt: "2026-08-01",
    },
  }));
  const keys = goods.map((k) => String(Number(k) + 1000));
  const next = {
    ...job,
    run_id: receiptSeoRunId(base.owner, "a", job.run_id),
    run_created_at: "2026-11-27",
    registration_job_id: "upload-two",
    registration_payload: { goodsKeys: keys },
  };
  const newLedger = ledger.map((r, i) => ({ ...r, goods_key: keys[i] }));
  const params = {
    jobs: [next, job],
    lifecycle: old,
    verifiedUploads: new Map([
      ["upload-two", { itemId: "a", goodsKeys: keys }],
    ]),
  };
  assert.equal(
    plan({ ...params, ledger: [...ledger, ...newLedger] }).rows[0].state,
    "DONE",
  );
  const partial = plan({
    ...params,
    ledger: [...ledger, ...newLedger.slice(0, 3)],
  }).rows[0];
  assert.equal(partial.state, "RESUME");
  assert.equal(partial.runId, next.run_id);
  assert.equal(partial.markets, 3);
  assert.equal(
    receiptSeoSuccessors(base.owner, old, [next], now).get("a").previousRun,
    job.run_id,
  );
  for (const alternative of [
    { ...next, run_id: "other" },
    { ...next, run_created_at: "2026-08-01" },
    {
      ...next,
      registration_payload: { goodsKeys: [goods[0], ...keys.slice(1)] },
    },
  ])
    assert.equal(
      receiptSeoSuccessors(base.owner, old, [alternative], now).size,
      0,
    );
  assert.equal(
    receiptSeoSuccessors(
      base.owner,
      old.map((r) => ({ ...r, attempt_count: 3 })),
      [next],
      now,
    ).size,
    0,
  );
});
test("an uncertain or conflicting submit receipt cannot mark a listing complete", () => {
  const r = plan({
    jobs: [job],
    verifiedUploads: uploads,
    ledger: ledger.map((l, i) =>
      i === 0 ? { ...l, market_status: "confirm_needed" } : l,
    ),
  }).rows[0];
  assert.equal(r.state, "HOLD");
  assert.equal(r.markets, 5);
});

test("earlier receipt drafts can be reviewed without scheduling a new listing", () => {
  const rows = plan({
    draftId,
    lines: [line("BCE6-1", { legacyPreview: true })],
  }).rows;
  assert.equal(rows[0].state, "HOLD");
  assert.equal(rows[0].runId, "");
  assert.match(rows[0].rotation, /이전 차시 조회/);
});
