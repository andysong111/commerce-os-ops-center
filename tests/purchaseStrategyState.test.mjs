import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

async function loadModule() {
  const sourcePath = new URL("../src/lib/purchaseStrategyState.ts", import.meta.url);
  const source = (await readFile(sourcePath, "utf8"))
    .replace(
      /^import \{ createSupabaseAdminClient \} from "@\/lib\/supabase\/admin";\s*/m,
      "const createSupabaseAdminClient = async () => globalThis.__purchaseStrategyAdminClient ?? null;\n",
    )
    .replace(
      'from "@/lib/productDecisionEngine/purchaseStrategyPolicy"',
      `from ${JSON.stringify(
        new URL(
          "../src/lib/productDecisionEngine/purchaseStrategyPolicy.ts",
          import.meta.url,
        ).href,
      )}`,
    );
  const directory = await mkdtemp(
    join(dirname(fileURLToPath(sourcePath)), ".purchase-strategy-test-"),
  );
  const file = join(directory, "purchaseStrategyState.ts");
  await writeFile(file, source);
  try {
    return await import(`${pathToFileURL(file).href}?v=${Date.now()}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const strategy = await loadModule();
const {
  DEFAULT_PURCHASE_STRATEGY_CONFIG,
  PURCHASE_STRATEGY_CONFIG_OPERATION_TYPE,
  PURCHASE_STRATEGY_MAX_EVENT_ROWS,
  PURCHASE_STRATEGY_PRODUCT_STATUS_OPERATION_TYPE,
  PURCHASE_STRATEGY_READ_LIMIT,
  buildPurchaseStrategyConfigUpdate,
  foldPurchaseStrategyState,
  loadPurchaseStrategyState,
  normalizePurchaseStrategyBarcode,
  normalizePurchaseStrategyProductEvent,
} = strategy;

const baseConfigInput = {
  monthlyRevenueThresholdKrw: 40_000,
  newProductProtectionDays: 365,
  baseCoverMonths: 1.5,
  risingCoverMonths: { weak: 2, medium: 3, strong: 4 },
  automaticMaxCoverMonths: 4,
  manualHeroMaxCoverMonths: 6,
};

function configRow(version, occurredAt, overrides = {}) {
  return {
    operation_type: PURCHASE_STRATEGY_CONFIG_OPERATION_TYPE,
    source_event_id: `config-v${version}`,
    started_at: occurredAt,
    input_snapshot: {
      schemaVersion: 1,
      action: "UPDATE_CONFIG",
      actor: "owner@example.com",
      occurredAt,
      config: {
        version,
        ...baseConfigInput,
        ...overrides,
      },
    },
  };
}

function productRow(action, barcode, occurredAt, overrides = {}) {
  return {
    operation_type: PURCHASE_STRATEGY_PRODUCT_STATUS_OPERATION_TYPE,
    source_event_id: `${action.toLowerCase()}-${barcode}-${occurredAt}`,
    started_at: occurredAt,
    input_snapshot: {
      schemaVersion: 1,
      action,
      barcode,
      reason: action === "DISCONTINUE" ? "판매 종료 결정" : "판매 재개 결정",
      actor: "owner@example.com",
      occurredAt,
      ...overrides,
    },
  };
}

test("default policy matches the owner's initial simple strategy", () => {
  const state = foldPurchaseStrategyState([], []);
  assert.deepEqual(state.config, DEFAULT_PURCHASE_STRATEGY_CONFIG);
  assert.equal(state.config.monthlyRevenueThresholdKrw, 40_000);
  assert.equal(state.config.newProductProtectionDays, 365);
  assert.equal(state.config.baseCoverMonths, 1.5);
  assert.deepEqual(state.config.risingCoverMonths, {
    weak: 2,
    medium: 3,
    strong: 4,
  });
  assert.equal(state.config.automaticMaxCoverMonths, 4);
  assert.equal(state.config.manualHeroMaxCoverMonths, 6);
  assert.deepEqual(state.states, []);
});

test("config updates are full snapshots with a server-controlled next version", () => {
  const updated = buildPurchaseStrategyConfigUpdate(
    { ...baseConfigInput, monthlyRevenueThresholdKrw: 60_000 },
    7,
  );
  assert.equal(updated.version, 8);
  assert.equal(updated.monthlyRevenueThresholdKrw, 60_000);

  const minimum = buildPurchaseStrategyConfigUpdate(
    { ...baseConfigInput, monthlyRevenueThresholdKrw: 10_000 },
    8,
  );
  assert.equal(minimum.monthlyRevenueThresholdKrw, 10_000);

  assert.throws(
    () =>
      buildPurchaseStrategyConfigUpdate(
        { ...baseConfigInput, monthlyRevenueThresholdKrw: 9_000 },
        8,
      ),
    /monthlyRevenueThresholdKrw 값은 10000 이상 10000000 이하/,
  );

  assert.throws(
    () =>
      buildPurchaseStrategyConfigUpdate(
        { ...baseConfigInput, monthlyRevenueThresholdKrw: 10_001_000 },
        8,
      ),
    /monthlyRevenueThresholdKrw 값은 10000 이상 10000000 이하/,
  );

  assert.throws(
    () =>
      buildPurchaseStrategyConfigUpdate(
        { ...baseConfigInput, monthlyRevenueThresholdKrw: "40000" },
        1,
      ),
    /monthlyRevenueThresholdKrw 값은 유한한 숫자/,
  );
  assert.throws(
    () =>
      buildPurchaseStrategyConfigUpdate(
        { ...baseConfigInput, unknownSetting: true },
        1,
      ),
    /필드는/,
  );
});

test("cover settings reject unsafe order and maxima", () => {
  assert.throws(
    () =>
      buildPurchaseStrategyConfigUpdate(
        {
          ...baseConfigInput,
          risingCoverMonths: { weak: 3, medium: 2, strong: 4 },
        },
        1,
      ),
    /재고개월은 기본/,
  );
  assert.throws(
    () =>
      buildPurchaseStrategyConfigUpdate(
        { ...baseConfigInput, automaticMaxCoverMonths: 4.5 },
        1,
      ),
    /automaticMaxCoverMonths 값은 0.5 이상 4 이하/,
  );
  assert.throws(
    () =>
      buildPurchaseStrategyConfigUpdate(
        { ...baseConfigInput, manualHeroMaxCoverMonths: 7 },
        1,
      ),
    /manualHeroMaxCoverMonths 값은 0.5 이상 6 이하/,
  );
});

test("managed B-code normalization is strict", () => {
  assert.equal(normalizePurchaseStrategyBarcode(" bgg1–1 "), "BGG1-1");
  assert.throws(
    () => normalizePurchaseStrategyBarcode("BGG1"),
    /관리 가능한 B코드 형식/,
  );
  assert.throws(
    () => normalizePurchaseStrategyBarcode("123456"),
    /관리 가능한 B코드 형식/,
  );
});

test("permanent discontinue and restore fold to current state while preserving history", () => {
  const discontinuedAt = "2026-10-22T01:00:00.000Z";
  const restoredAt = "2026-10-23T01:00:00.000Z";
  const state = foldPurchaseStrategyState(
    [
      configRow(3, "2026-10-22T00:02:00.000Z", {
        monthlyRevenueThresholdKrw: 60_000,
      }),
      configRow(2, "2026-10-22T00:01:00.000Z"),
    ],
    [
      productRow("RESTORE", "BBC1-1", restoredAt),
      productRow("DISCONTINUE", "BBC1-1", discontinuedAt),
    ],
  );

  assert.equal(state.config.version, 3);
  assert.equal(state.config.monthlyRevenueThresholdKrw, 60_000);
  assert.equal(state.states.length, 1);
  assert.deepEqual(state.states[0], {
    barcode: "BBC1-1",
    status: "ACTIVE",
    discontinuedReason: "판매 종료 결정",
    discontinuedAt,
    discontinuedBy: "owner@example.com",
    restoredAt,
    restoredBy: "owner@example.com",
    restoreReason: "판매 재개 결정",
    updatedAt: restoredAt,
  });
  assert.deepEqual(
    state.productHistory.map((event) => event.action),
    ["RESTORE", "DISCONTINUE"],
  );
});

test("invalid permanent-state transitions fail instead of hiding ledger conflicts", () => {
  assert.throws(
    () =>
      foldPurchaseStrategyState(
        [],
        [productRow("RESTORE", "BBC1-1", "2026-10-22T01:00:00.000Z")],
      ),
    /복구할 영구 발주 제외 상태가 없습니다/,
  );
  assert.throws(
    () =>
      foldPurchaseStrategyState(
        [],
        [
          productRow("DISCONTINUE", "BBC1-1", "2026-10-22T01:00:00.000Z"),
          productRow("DISCONTINUE", "BBC1-1", "2026-10-22T02:00:00.000Z"),
        ],
      ),
    /이미 영구 발주 제외 상태/,
  );
});

test("temporary Draft exclusion is not a supported permanent status action", () => {
  assert.throws(
    () =>
      normalizePurchaseStrategyProductEvent({
        schemaVersion: 1,
        action: "EXCLUDE_FROM_DRAFT",
        barcode: "BBC1-1",
        reason: "이번 달 재고 충분",
        actor: "owner@example.com",
        occurredAt: "2026-10-22T01:00:00.000Z",
      }),
    /DISCONTINUE 또는 RESTORE/,
  );
});

test("duplicate config versions and source identities fail closed", () => {
  assert.throws(
    () =>
      foldPurchaseStrategyState(
        [
          configRow(2, "2026-10-22T01:00:00.000Z"),
          {
            ...configRow(2, "2026-10-22T02:00:00.000Z"),
            source_event_id: "different-source-id",
          },
        ],
        [],
      ),
    /정책 설정 버전 2이 중복/,
  );
  const duplicate = productRow(
    "DISCONTINUE",
    "BBC1-1",
    "2026-10-22T01:00:00.000Z",
  );
  assert.throws(
    () => foldPurchaseStrategyState([], [duplicate, duplicate]),
    /중복 저장 이벤트/,
  );
});

test("route is same-origin guarded, bounded and append-only", async () => {
  const [library, route] = await Promise.all([
    readFile("src/lib/purchaseStrategyState.ts", "utf8"),
    readFile("src/app/api/purchase-strategy/route.ts", "utf8"),
  ]);

  assert.equal(PURCHASE_STRATEGY_READ_LIMIT, 1_000);
  assert.equal(PURCHASE_STRATEGY_MAX_EVENT_ROWS, 20_000);
  assert.match(library, /count: "exact"/);
  assert.match(
    library,
    /\.range\(offset, offset \+ PURCHASE_STRATEGY_READ_LIMIT - 1\)/,
  );
  assert.match(library, /PURCHASE_STRATEGY_CHANGED_DURING_READ/);
  assert.match(library, /PURCHASE_STRATEGY_PARTIAL_PAGE/);
  assert.match(library, /\.from\("commerce_operation_runs"\)\.insert\(/);
  assert.match(library, /sourceEventPrefix.*randomUUID\(\)/s);
  assert.doesNotMatch(library, /\.from\("commerce_operation_runs"\)\.(?:update|delete|upsert)\(/);

  assert.match(route, /isSameOriginOpsRequest\(request\)/);
  assert.match(route, /UPDATE_CONFIG/);
  assert.match(route, /DISCONTINUE/);
  assert.match(route, /RESTORE/);
  assert.match(route, /temporaryDraftExclusionsStoredHere: false/);
  assert.match(route, /expectedVersion/);
  assert.match(route, /loadPurchaseStrategyState\(\)/);
  assert.match(route, /PURCHASE_STRATEGY_WRITE_NOT_VISIBLE/);
  assert.match(route, /PURCHASE_STRATEGY_READ_LIMIT/);
});

test("a permanent exclusion remains active after more than one thousand later events", async () => {
  const target = productRow(
    "DISCONTINUE",
    "BZZ1-1",
    "2025-01-01T00:00:00.000Z",
  );
  const later = Array.from({ length: 1_005 }, (_, index) =>
    productRow(
      "DISCONTINUE",
      `BAA${index + 10}-1`,
      new Date(Date.UTC(2025, 0, 2, 0, 0, index)).toISOString(),
    ),
  );
  const rowsByType = new Map([
    [PURCHASE_STRATEGY_CONFIG_OPERATION_TYPE, []],
    [PURCHASE_STRATEGY_PRODUCT_STATUS_OPERATION_TYPE, [target, ...later]],
  ]);
  const ranges = [];

  globalThis.__purchaseStrategyAdminClient = {
    from() {
      let operationType = "";
      const builder = {
        select() {
          return builder;
        },
        eq(field, value) {
          if (field === "operation_type") operationType = value;
          return builder;
        },
        order() {
          return builder;
        },
        async range(from, to) {
          ranges.push([operationType, from, to]);
          const rows = rowsByType.get(operationType) ?? [];
          return {
            data: rows.slice(from, to + 1),
            count: rows.length,
            error: null,
          };
        },
      };
      return builder;
    },
  };

  try {
    const state = await loadPurchaseStrategyState();
    assert.equal(
      state.states.find((row) => row.barcode === "BZZ1-1")?.status,
      "DISCONTINUED",
    );
    assert.equal(state.productHistory.length, 1_006);
    assert.deepEqual(
      ranges.filter(
        ([operationType]) =>
          operationType === PURCHASE_STRATEGY_PRODUCT_STATUS_OPERATION_TYPE,
      ),
      [
        [PURCHASE_STRATEGY_PRODUCT_STATUS_OPERATION_TYPE, 0, 999],
        [PURCHASE_STRATEGY_PRODUCT_STATUS_OPERATION_TYPE, 1_000, 1_999],
      ],
    );
    assert.equal(state.productHistoryMayBeTruncated, false);
  } finally {
    delete globalThis.__purchaseStrategyAdminClient;
  }
});

test("an oversized ledger fails closed instead of dropping old exclusions", async () => {
  globalThis.__purchaseStrategyAdminClient = {
    from() {
      let operationType = "";
      const builder = {
        select() {
          return builder;
        },
        eq(field, value) {
          if (field === "operation_type") operationType = value;
          return builder;
        },
        order() {
          return builder;
        },
        async range() {
          return {
            data: [],
            count:
              operationType === PURCHASE_STRATEGY_PRODUCT_STATUS_OPERATION_TYPE
                ? PURCHASE_STRATEGY_MAX_EVENT_ROWS + 1
                : 0,
            error: null,
          };
        },
      };
      return builder;
    },
  };

  try {
    await assert.rejects(
      loadPurchaseStrategyState(),
      /안전한 읽기 한도 20,000건을 넘었습니다/,
    );
  } finally {
    delete globalThis.__purchaseStrategyAdminClient;
  }
});
