import assert from "node:assert/strict";
import test from "node:test";
import {
  applyChinaLinkUsageBatches,
  makeChinaLinkUsageReceipt,
  makeMigrationTransport,
  planChinaLinkUsageMigration,
  planChinaLinkUsageRollback,
} from "../scripts/migrate-product-launch-china-link-usage.mjs";

const origin = "https://ops.example";
const link = (id) => `https://detail.1688.com/offer/${id}.html`;
const item = (id, props) => ({
  id,
  updatedAt: "2026-11-26T12:00:00+00:00",
  customField: { kept: true },
  ...props,
});
const snapshot = (items, revision = 1) => ({
  ok: true,
  stateExists: true,
  updatedAt: `rev-${revision}`,
  state: { items },
});

test("existing link order assigns first to common and remaining to purchase without overwriting explicit roles", () => {
  const split = { commonUrl: "", purchaseUrl: link(7), detailPageUrl: link(8), purchaseAlternates: [] };
  const body = snapshot([
    item("multi", { chinaProductLinks: [link(4), link(3), link(2)], primaryChinaProductLink: link(2) }),
    item("single", { chinaProductLinks: [link(1)] }),
    item("split", { chinaProductLinks: [link(1)], chinaLinkUsage: split }),
    item("none", {}),
    item("invalid", { chinaProductLinks: [link(5), "not a URL", link(6)] }),
    item("legacy", { detailPageSource: { primaryUrl: link(21), urls: [link(21), link(22)] } }),
  ]);
  const plan = planChinaLinkUsageMigration(body);
  assert.deepEqual(plan.report, {
    total: 6,
    alreadyMigrated: 1,
    noLinks: 1,
    singleLink: 1,
    multipleLinks: 2,
    conflictingPrimaryAliasCount: 1,
    invalidItemIds: ["invalid"],
  });
  assert.deepEqual(plan.patches, [
    ["legacy", link(21), [link(22)]],
    ["multi", link(4), [link(3), link(2)]],
    ["single", link(1), []],
  ].map(([itemId, commonUrl, purchaseAlternates]) => ({
    itemId,
    expectedUpdatedAt: body.state.items[0].updatedAt,
    patch: { chinaLinkUsage: { commonUrl, purchaseUrl: "", detailPageUrl: "", purchaseAlternates } },
  })));
  assert.match(plan.digest, /^[a-f0-9]{64}$/);
  assert.notEqual(plan.digest, planChinaLinkUsageMigration({ ...body, updatedAt: "rev-2" }).digest);
});

function mockApi(initial, options = {}) {
  let items = structuredClone(initial);
  let normalized = structuredClone(options.normalizedItems ?? initial);
  let revision = 1;
  const writeBatches = [];
  const query = async (path, input) => {
    if (input) {
      assert.equal(input.operation, "bulk_patch_items");
      assert.equal(input.expectedStateUpdatedAt, `rev-${revision}`);
      writeBatches.push(structuredClone(input.patches));
      const byId = new Map(input.patches.map((entry) => [entry.itemId, entry]));
      const update = (rows, isNormalized) => rows.map((row) => {
        const entry = byId.get(row.id);
        if (!entry) return row;
        assert.equal(row.updatedAt, isNormalized ? entry.expectedNormalizedUpdatedAt : entry.expectedUpdatedAt);
        if (isNormalized) assert.equal(typeof entry.expectedNormalizedLinkUsage.commonUrl, "string");
        assert.deepEqual(Object.keys(entry.patch), ["chinaLinkUsage"]);
        const original = { ...row };
        delete original.chinaLinkUsage;
        const usage = entry.patch.chinaLinkUsage;
        const changed = usage === null ? original : { ...original, chinaLinkUsage: usage };
        if (isNormalized ? options.mutateNormalizedField : options.mutateUnrelatedField) {
          changed.customField = { corrupted: true };
        }
        return changed;
      });
      items = update(items, false);
      normalized = update(normalized, true);
      revision++;
      return {
        changedIds: [...byId.keys()],
        updatedAt: `rev-${revision}`,
        normalizedSynced: options.normalizedSynced !== false,
      };
    }
    if (path === "?mode=export") return structuredClone(snapshot(items, revision));
    const params = new URLSearchParams(path);
    assert.equal(params.get("mode"), "items-direct");
    const filtered = normalized.filter((row) => params.getAll("id").includes(row.id));
    if (options.staleDetail && revision > 1) {
      return {
        itemSource: "normalized-direct",
        items: filtered.map((row) => {
          const copy = { ...row };
          delete copy.chinaLinkUsage;
          return copy;
        }),
      };
    }
    return structuredClone({ itemSource: "normalized-direct", items: filtered });
  };
  return { query, writeBatches };
}

test("migration verifies both reads per batch, reruns idempotently, and rollback leaves newer edits in place", async () => {
  const original = Array.from({ length: 32 }, (_, i) => item(`item-${i}`, {
    chinaProductLinks: [link(i + 1), link(i + 51)],
    detailPageSource: { source: "existing metadata" },
  }));
  const transport = mockApi(original);
  const plan = planChinaLinkUsageMigration(await transport.query("?mode=export"));
  const receipt = makeChinaLinkUsageReceipt(origin, plan);
  const result = await applyChinaLinkUsageBatches(transport.query, plan.patches, plan.snapshot);
  assert.deepEqual(result, { changed: 32, normalizedBatches: 2 });
  assert.deepEqual(transport.writeBatches.map((batch) => batch.length), [30, 2]);
  const after = await transport.query("?mode=export");
  assert.equal(planChinaLinkUsageMigration(after).patches.length, 0);
  const newer = structuredClone(after);
  newer.state.items[0].chinaLinkUsage.purchaseUrl = link(500);
  const protectedRollback = planChinaLinkUsageRollback(newer, receipt, origin);
  assert.deepEqual(protectedRollback.preservedChangedItemIds, [original[0].id]);
  assert.equal(protectedRollback.patches.length, 31);
  const rollback = planChinaLinkUsageRollback(after, receipt, origin);
  assert.equal(rollback.patches.length, 32);
  await applyChinaLinkUsageBatches(transport.query, rollback.patches, rollback.snapshot);
  assert.deepEqual((await transport.query("?mode=export")).state.items, original);
  assert.equal(planChinaLinkUsageRollback(await transport.query("?mode=export"), receipt, origin).patches.length, 0);
});

test("migration aborts on duplicate product IDs and readback drift", async () => {
  const inputs = [item("single", { chinaProductLinks: [link(1)] })];
  assert.throws(() => planChinaLinkUsageMigration(snapshot([inputs[0], inputs[0]])), /중복/);
  for (const [options, error] of [
    [{ mutateUnrelatedField: true }, /기존 데이터/],
    [{ mutateNormalizedField: true }, /상품 상세의 기존 데이터/],
    [{ staleDetail: true }, /상품 상세 조회/],
    [{ normalizedSynced: false }, /동기화/],
  ]) {
    const { query } = mockApi(inputs, options);
    const plan = planChinaLinkUsageMigration(await query("?mode=export"));
    await assert.rejects(applyChinaLinkUsageBatches(query, plan.patches, plan.snapshot), error);
  }
  const pending = mockApi(inputs, { normalizedItems: [
    { ...inputs[0], chinaProductLinks: [link(99)], updatedAt: "2026-11-26T12:10:00+00:00" },
  ] });
  const plan = planChinaLinkUsageMigration(await pending.query("?mode=export"));
  await assert.rejects(applyChinaLinkUsageBatches(pending.query, plan.patches, plan.snapshot), /동기화되지 않은 변경/);
  assert.equal(pending.writeBatches.length, 0);
});

test("newer normalized edits with identical links survive migration and carry the direct revision guard", async () => {
  const raw = item("one", { chinaProductLinks: [link(1)] });
  const detail = { ...raw, updatedAt: "2026-11-26T12:10:00+00:00", updatedBy: "direct editor", orderOptions: [{ barcode: "BCA1-2" }] };
  const transport = mockApi([raw], { normalizedItems: [detail] });
  const plan = planChinaLinkUsageMigration(await transport.query("?mode=export"));
  await applyChinaLinkUsageBatches(transport.query, plan.patches, plan.snapshot);
  const [entry] = transport.writeBatches[0];
  assert.equal(entry.expectedNormalizedUpdatedAt, detail.updatedAt);
  assert.equal(entry.expectedNormalizedLinkUsage.commonUrl, link(1));
  const saved = await transport.query("?mode=items-direct&id=one");
  assert.deepEqual(saved.items[0].orderOptions, detail.orderOptions);
  assert.equal(saved.items[0].updatedAt, detail.updatedAt);
});

function historicalPurchaseLinkRows(rawLinks, olderLinks) {
  const old = item("one", {
    modelNumber: "AAA189",
    updatedAt: "2026-11-10T11:00:00.000Z",
    chinaProductLinks: olderLinks,
  });
  const authoritative = item("one", {
    modelNumber: old.modelNumber,
    updatedAt: "2026-11-26T12:00:00.075Z",
    updatedBy: "중국 발주초안 구매정보 역저장",
    purchaseMetadataLastWrite: {
      field: "MODEL_LINK_AND_BCODE_CHINA_OPTION",
      source: "CHINA_ORDER_DRAFT",
      savedBy: "승준",
      draftId: "fast-purchase-draft:0123456789abcdef0123",
      modelNo: "AAA189",
      barcodes: ["BAA3-1"],
      savedAt: "2026-11-26T12:00:00.000Z",
    },
    primaryChinaProductLink: rawLinks[0],
    detailPageSource: { primaryUrl: rawLinks[0], urls: rawLinks, pinnedIndex: 0 },
    chinaProductLinks: rawLinks,
  });
  return [authoritative, old];
}

test("only a verified historical draft receipt permits an older normalized link projection to differ", async () => {
  const older = [link(1), link(2), link(3)];
  for (const transformed of [
    [link(4), ...older],
    [link(2), link(1), link(3)],
    [link(1), link(4), link(2), link(3)],
  ]) {
    const [raw, detail] = historicalPurchaseLinkRows(transformed, older);
    const transport = mockApi([raw], { normalizedItems: [detail] });
    const plan = planChinaLinkUsageMigration(await transport.query("?mode=export"));
    await applyChinaLinkUsageBatches(transport.query, plan.patches, plan.snapshot);
    const [entry] = transport.writeBatches[0];
    assert.equal(entry.expectedNormalizedLinkUsage.commonUrl, link(1));
    assert.equal(entry.patch.chinaLinkUsage.commonUrl, transformed[0]);
  }
  for (const corrupt of [
    (raw) => { raw.purchaseMetadataLastWrite.modelNo = "AAA901"; },
    (raw) => { raw.purchaseMetadataLastWrite.savedAt = "2026-11-26T11:59:00.000Z"; },
    (_raw, detail) => { detail.updatedAt = "2026-11-26T12:00:00.050Z"; },
    (raw) => { raw.detailPageSource.pinnedIndex = 1; },
    (_raw, detail) => { detail.chinaProductLinks = [link(1), link(9), link(3)]; },
  ]) {
    const [raw, detail] = historicalPurchaseLinkRows([link(4), ...older], older);
    corrupt(raw, detail);
    const transport = mockApi([raw], { normalizedItems: [detail] });
    const plan = planChinaLinkUsageMigration(await transport.query("?mode=export"));
    await assert.rejects(applyChinaLinkUsageBatches(transport.query, plan.patches, plan.snapshot), /동기화되지 않은 변경/);
    assert.equal(transport.writeBatches.length, 0);
  }
});

test("transport pins requests to configured HTTPS origin and protects scoped cookies from redirects", async () => {
  assert.throws(() => makeMigrationTransport("http://ops.example"), /HTTPS/);
  const query = makeMigrationTransport(origin, {
    OPS_PRODUCT_LAUNCH_SESSION_COOKIE: "test-cookie",
    VERCEL_AUTOMATION_BYPASS_SECRET: "test-secret",
  }, async (url, options) => {
    assert.ok([
      `${origin}/api/product-launch-tracker/optimized?mode=export`,
      `${origin}/api/product-launch-tracker/item-editor?mode=items-direct&id=item-1`,
    ].includes(url));
    assert.equal(options.redirect, "error");
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Origin, origin);
    assert.equal(options.headers.Cookie, "test-cookie");
    assert.equal(options.headers["x-vercel-protection-bypass"], "test-secret");
    return new Response(JSON.stringify({ ok: true }));
  });
  await query("?mode=export");
  await query("?mode=items-direct&id=item-1");
});
