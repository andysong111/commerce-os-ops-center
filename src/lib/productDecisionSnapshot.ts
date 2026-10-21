import type { PurchaseStrategyEvaluation } from "@/lib/productDecisionEngine/purchaseStrategyPolicy";

export const VERIFIED_PRODUCT_DECISION_BACKUP = {
  zipSha256: "81968ab38e3ab177c7e8cb3aff9e95554752ab4ee7257854e8feaf6a89c808ba",
  dashboardSha256: "cf7892ab0776a3de126afecccf29917f4315c8fc66240dd156ce8c9ecf697a9e",
  source: "https://commerce-os-product-decision-agent.andy123df23.chatgpt.site",
  exportedAt: "2026-08-05T09:58:04.240Z",
  completedAt: "2026-08-05T10:01:33.070Z",
  totalRows: 67_260,
  productCount: 316,
  counts: {
    __appgarden_migrations: 2,
    app_settings: 8,
    background_jobs: 8,
    canonical_products: 5_978,
    claims: 543,
    decision_evidence: 5_892,
    decision_feedback: 5_892,
    decision_items: 7_511,
    decision_runs: 26,
    inventory_positions: 0,
    monthly_metrics: 13_335,
    order_lines: 12_434,
    packaging_profiles: 0,
    product_planning_profiles: 0,
    purchase_commitment_events: 0,
    purchase_commitments: 0,
    shopling_product_options: 15_628,
    sync_runs: 3,
  },
} as const;

export type ProductDecisionScore = {
  total?: number;
};

export type ProductDecisionRow = {
  barcode?: string;
  name?: string;
  modelNo?: string | null;
  status?: string;
  demandStatus?: string;
  trend?: string;
  recommendedQty?: number;
  rawRecommendedQty?: number;
  forecastUnits?: number;
  expectedCost?: number;
  estimatedStock?: number;
  openCommitment?: number;
  securedQuantity?: number;
  netRequiredRaw?: number;
  inventoryKnown?: boolean;
  entrySignals?: string[];
  recoveredStockoutDemandUnits?: number;
  weightedClaimRate?: number;
  averageSellingPriceKrw?: number;
  purchaseStrategy?: PurchaseStrategyEvaluation | null;
  score?: ProductDecisionScore;
};

export type ProductDecisionSnapshot = {
  mode?: "DEMO" | "LIVE";
  notice?: string;
  runId?: string;
  runStatus?: string;
  generatedAt?: string;
  periodLabel?: string;
  budget?: number;
  budgetBasis?: string;
  expectedSpend?: number;
  products?: ProductDecisionRow[];
};

export type PortableD1TableManifest = {
  name?: string;
  count?: number;
};

export type PortableD1Manifest = {
  ok?: boolean;
  formatVersion?: number;
  exportedAt?: string;
  tables?: PortableD1TableManifest[];
};

export type PortableD1Completed = {
  ok?: boolean;
  formatVersion?: number;
  completedAt?: string;
  source?: string;
  counts?: Record<string, number>;
};

export type ProductDecisionRawTables = {
  decision_runs: unknown[];
  decision_items: unknown[];
  canonical_products: unknown[];
  decision_evidence: unknown[];
  product_planning_profiles: unknown[];
};

export function validateProductDecisionBackupMetadata(
  manifest: PortableD1Manifest,
  completed: PortableD1Completed,
  zipSha256: string,
) {
  if (zipSha256 !== VERIFIED_PRODUCT_DECISION_BACKUP.zipSha256) {
    throw new Error("선택한 ZIP은 검증된 발주 추천 D1 백업과 일치하지 않습니다.");
  }
  if (manifest.ok !== true || manifest.formatVersion !== 1) {
    throw new Error("D1 manifest 형식이 올바르지 않습니다.");
  }
  if (completed.ok !== true || completed.formatVersion !== 1) {
    throw new Error("D1 백업 완료표식이 올바르지 않습니다.");
  }
  if (
    manifest.exportedAt !== VERIFIED_PRODUCT_DECISION_BACKUP.exportedAt ||
    completed.completedAt !== VERIFIED_PRODUCT_DECISION_BACKUP.completedAt ||
    completed.source !== VERIFIED_PRODUCT_DECISION_BACKUP.source
  ) {
    throw new Error("D1 백업의 원본 주소 또는 생성 시각이 검증 기록과 다릅니다.");
  }

  const manifestCounts = Object.fromEntries(
    (manifest.tables ?? []).map((table) => [String(table.name ?? ""), Number(table.count)]),
  );
  for (const [table, expected] of Object.entries(
    VERIFIED_PRODUCT_DECISION_BACKUP.counts,
  )) {
    if (
      manifestCounts[table] !== expected ||
      Number(completed.counts?.[table]) !== expected
    ) {
      throw new Error(`${table} 행 수가 검증된 백업 기록과 다릅니다.`);
    }
  }

  const total = Object.values(manifestCounts).reduce(
    (sum, value) => sum + (Number.isFinite(value) ? value : 0),
    0,
  );
  if (total !== VERIFIED_PRODUCT_DECISION_BACKUP.totalRows) {
    throw new Error("D1 백업 전체 행 수가 검증 기록과 다릅니다.");
  }
}

export function buildProductDecisionSnapshot(
  tables: ProductDecisionRawTables,
): ProductDecisionSnapshot {
  const runs = tables.decision_runs
    .map(record)
    .filter((run) => text(run.id) && text(run.generated_at))
    .sort((left, right) =>
      text(right.generated_at).localeCompare(text(left.generated_at)),
    );
  const run = runs[0];
  if (!run) throw new Error("백업에서 발주 계산 이력을 찾지 못했습니다.");

  const runId = text(run.id);
  const productsByBarcode = new Map(
    tables.canonical_products.map((value) => {
      const row = record(value);
      return [text(row.barcode), row] as const;
    }),
  );
  const evidenceByBarcode = new Map(
    tables.decision_evidence
      .map(record)
      .filter((row) => text(row.run_id) === runId)
      .map((row) => [text(row.barcode), row] as const),
  );
  const profileByBarcode = new Map(
    tables.product_planning_profiles.map((value) => {
      const row = record(value);
      return [text(row.barcode), row] as const;
    }),
  );

  const products: ProductDecisionRow[] = tables.decision_items
    .map(record)
    .filter((item) => text(item.run_id) === runId)
    .map((item) => {
      const barcode = text(item.barcode);
      const product = productsByBarcode.get(barcode) ?? {};
      const evidence = evidenceByBarcode.get(barcode);
      const profile = profileByBarcode.get(barcode);
      const flags = safeJsonArray(item.flags_json);
      const calculation = safeJsonObject(evidence?.calculation_json);
      const order = record(calculation.order);
      const netRequirement = record(calculation.netRequirement);
      const demandTarget =
        nonnegativeNumber(netRequirement.demandTarget) ??
        numberFlag(flags, "수요목표") ??
        nonnegativeNumber(order.rawRecommendedQuantity) ??
        nonnegativeNumber(order.recommendedQuantity) ??
        nonnegativeNumber(item.recommended_quantity_gross) ??
        0;
      const estimatedStock =
        nonnegativeNumber(netRequirement.estimatedStock) ??
        numberFlag(flags, "추정재고") ??
        0;
      const openCommitment =
        nonnegativeNumber(netRequirement.openCommitment) ??
        numberFlag(flags, "진행발주") ??
        0;
      const securedQuantity =
        nonnegativeNumber(netRequirement.securedQuantity) ??
        numberFlag(flags, "확보수량") ??
        estimatedStock + openCommitment;
      const netRequiredRaw =
        nonnegativeNumber(netRequirement.netRequiredRaw) ??
        numberFlag(flags, "신규필요") ??
        Math.max(0, demandTarget - securedQuantity);
      const inventoryKnown =
        typeof netRequirement.inventoryKnown === "boolean"
          ? netRequirement.inventoryKnown
          : flagValue(flags, "재고기준") === "확정";

      return {
        barcode,
        name: text(product.canonical_name) || barcode,
        modelNo: profile ? text(profile.model_no) || null : null,
        status: text(item.decision_status),
        demandStatus: text(order.group) || text(item.decision_status),
        trend: text(item.trend_label),
        recommendedQty: nonnegativeNumber(item.recommended_quantity_gross) ?? 0,
        rawRecommendedQty: demandTarget,
        forecastUnits:
          nonnegativeNumber(order.forecastUnits || item.forecast_units) ?? 0,
        expectedCost: nonnegativeNumber(item.expected_cost) ?? 0,
        estimatedStock,
        openCommitment,
        securedQuantity,
        netRequiredRaw,
        inventoryKnown,
        score: {
          total:
            nonnegativeNumber(
              evidence?.purchase_need_score ?? item.total_score,
            ) ?? 0,
        },
      };
    })
    .sort(
      (left, right) =>
        Number(right.score?.total ?? 0) - Number(left.score?.total ?? 0) ||
        text(left.barcode).localeCompare(text(right.barcode), "ko"),
    );

  if (products.length !== VERIFIED_PRODUCT_DECISION_BACKUP.productCount) {
    throw new Error(
      `최신 발주안 상품 수가 ${products.length}개로 검증값 ${VERIFIED_PRODUCT_DECISION_BACKUP.productCount}개와 다릅니다.`,
    );
  }

  const expectedSpend = products
    .filter(
      (product) =>
        product.status === "발주 추천" || product.status === "소량 검토",
    )
    .reduce((sum, product) => sum + Number(product.expectedCost ?? 0), 0);

  return {
    mode: "LIVE",
    notice:
      "검증된 기존 D1 백업에서 복원한 발주 추천 스냅샷입니다. 실제 주문·결제·샵플링 변경은 실행하지 않습니다.",
    runId,
    runStatus: text(run.status),
    generatedAt: text(run.generated_at),
    periodLabel: "검증 백업 기준 최신 발주안",
    budget: nonnegativeNumber(run.budget) ?? 0,
    budgetBasis: text(run.budget_basis),
    expectedSpend,
    products,
  };
}

export function stableStringify(value: unknown) {
  return JSON.stringify(stableValue(value));
}

export async function sha256Hex(value: string | ArrayBuffer | Uint8Array) {
  const source =
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : value instanceof Uint8Array
        ? value
        : new Uint8Array(value);
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(row)
        .sort()
        .map((key) => [key, stableValue(row[key])]),
    );
  }
  return value;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function safeJsonArray(value: unknown) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function safeJsonObject(value: unknown) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return record(parsed);
  } catch {
    return {};
  }
}

function nonnegativeNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : undefined;
}

function flagValue(flags: string[], key: string) {
  const prefix = `${key}:`;
  return flags.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function numberFlag(flags: string[], key: string) {
  const parsed = Number(flagValue(flags, key));
  return Number.isFinite(parsed) ? parsed : undefined;
}
