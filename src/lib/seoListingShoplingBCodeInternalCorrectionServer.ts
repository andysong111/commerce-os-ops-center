import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type UnknownRecord = Record<string, unknown>;
type AdminClient = NonNullable<
  Awaited<ReturnType<typeof createSupabaseAdminClient>>
>;

const PLAN_FINGERPRINT = /^sha256:[0-9a-f]{64}$/;
const READ_BATCH_SIZE = 200;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function rows(value: unknown) {
  return Array.isArray(value) ? (value as UnknownRecord[]) : [];
}

function chunks<T>(values: T[], size = READ_BATCH_SIZE) {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function throwIfError(
  label: string,
  result: { error: { message: string } | null },
) {
  if (result.error) throw new Error(`${label}:${result.error.message}`);
}

function correctionPlan(value: unknown, ownerId: string, fingerprint: string) {
  const plan = record(value);
  if (
    !PLAN_FINGERPRINT.test(fingerprint) ||
    text(plan.planFingerprint) !== fingerprint ||
    text(plan.ownerId) !== ownerId ||
    text(plan.schemaVersion) !==
      "seo-listing-bcode-internal-correction-plan-v1" ||
    plan.readyToApply !== true ||
    text(plan.applyScope) !== "INTERNAL_DB_ONLY" ||
    !Array.isArray(plan.auditReceipts) ||
    !Array.isArray(plan.isolationMarkers) ||
    !Array.isArray(plan.marketLedgerRepairs)
  ) {
    throw new Error("SEO_BCODE_INTERNAL_CORRECTION_PLAN_INVALID");
  }
  return plan;
}

function marketLedgerBindings(plan: UnknownRecord) {
  return rows(plan.marketLedgerRepairs).flatMap((repair) =>
    rows(repair.bindings).map((binding) => ({
      goodsKey: text(binding.goodsKey),
      beforeLaunchItemId: text(binding.existingLedgerLaunchItemId),
      beforeProfile: text(binding.existingLedgerProfile),
      afterLaunchItemId: text(binding.intendedLedgerLaunchItemId),
      afterProfile: text(binding.intendedLedgerProfile),
    })),
  );
}

async function readLedgerRows(
  admin: AdminClient,
  ownerId: string,
  goodsKeys: string[],
) {
  const output: UnknownRecord[] = [];
  for (const batch of chunks(goodsKeys)) {
    if (batch.length === 0) continue;
    const result = await admin
      .from("shopling_market_pipeline_ledger")
      .select("goods_key,launch_item_id,profile,updated_at")
      .eq("owner_id", ownerId)
      .in("goods_key", batch)
      .limit(batch.length);
    throwIfError("SEO_BCODE_INTERNAL_CORRECTION_LEDGER_READBACK_FAILED", result);
    output.push(...rows(result.data));
  }
  return output;
}

async function verifyCorrectionReadback(input: {
  admin: AdminClient;
  ownerId: string;
  plan: UnknownRecord;
  planFingerprint: string;
  ledgerState: "before" | "after";
  expectActiveIsolation: boolean;
}) {
  const isolationResult = await input.admin
    .from("seo_listing_lifecycle_isolations")
    .select("launch_item_id,isolation_fingerprint,correction_plan_fingerprint,active")
    .eq("owner_id", input.ownerId)
    .eq("correction_plan_fingerprint", input.planFingerprint)
    .eq("active", input.expectActiveIsolation)
    .limit(1000);
  throwIfError("SEO_BCODE_INTERNAL_CORRECTION_ISOLATION_READBACK_FAILED", isolationResult);
  const expectedIsolationCount = rows(input.plan.isolationMarkers).length;
  if (rows(isolationResult.data).length !== expectedIsolationCount) {
    throw new Error("SEO_BCODE_INTERNAL_CORRECTION_ISOLATION_READBACK_MISMATCH");
  }

  const bindings = marketLedgerBindings(input.plan);
  const ledgerRows = await readLedgerRows(
    input.admin,
    input.ownerId,
    bindings.map((binding) => binding.goodsKey),
  );
  const ledgerByGoodsKey = new Map(
    ledgerRows.map((row) => [text(row.goods_key), row]),
  );
  for (const binding of bindings) {
    const saved = ledgerByGoodsKey.get(binding.goodsKey);
    const expectedLaunchItemId =
      input.ledgerState === "after"
        ? binding.afterLaunchItemId
        : binding.beforeLaunchItemId;
    const expectedProfile =
      input.ledgerState === "after" ? binding.afterProfile : binding.beforeProfile;
    if (
      !saved ||
      text(saved.launch_item_id) !== expectedLaunchItemId ||
      text(saved.profile) !== expectedProfile
    ) {
      throw new Error(
        `SEO_BCODE_INTERNAL_CORRECTION_LEDGER_READBACK_MISMATCH:${binding.goodsKey}`,
      );
    }
  }
  return {
    isolationMarkerCount: rows(isolationResult.data).length,
    marketLedgerBindingCount: bindings.length,
  };
}

export async function applySeoListingShoplingBCodeInternalCorrection(input: {
  ownerId: string;
  approvedPlanFingerprint: string;
  currentPlan: unknown;
  now?: Date;
}) {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const priorResult = await admin
    .from("commerce_operation_runs")
    .select("status,input_snapshot,result_snapshot,finished_at")
    .eq(
      "source_event_id",
      `seo-listing-bcode-correction:${input.approvedPlanFingerprint}`,
    )
    .eq("correlation_id", input.ownerId)
    .maybeSingle();
  throwIfError("SEO_BCODE_INTERNAL_CORRECTION_REPLAY_READ_FAILED", priorResult);
  const prior = record(priorResult.data);
  const replayed = text(prior.status) === "SUCCEEDED";
  const plan = correctionPlan(
    replayed ? prior.input_snapshot : input.currentPlan,
    input.ownerId,
    input.approvedPlanFingerprint,
  );
  const appliedAt =
    (replayed ? text(prior.finished_at) : "") ||
    (input.now ?? new Date()).toISOString();
  const result = replayed
    ? { data: prior.result_snapshot, error: null }
    : await admin.rpc("apply_seo_listing_bcode_internal_correction_v1", {
        p_owner_id: input.ownerId,
        p_plan_fingerprint: input.approvedPlanFingerprint,
        p_plan: plan,
        p_applied_at: appliedAt,
      });
  throwIfError("SEO_BCODE_INTERNAL_CORRECTION_APPLY_FAILED", result);

  const receiptIds = rows(plan.auditReceipts).map(
    (receipt) => `seo-listing-bcode-receipt:${text(receipt.fingerprint)}`,
  );
  const persistedReceipts: UnknownRecord[] = [];
  for (const batch of chunks(receiptIds)) {
    const receiptResult = await admin
      .from("commerce_operation_runs")
      .select("source_event_id,status,input_snapshot,result_snapshot")
      .in("source_event_id", batch)
      .limit(batch.length);
    throwIfError("SEO_BCODE_INTERNAL_CORRECTION_RECEIPT_READBACK_FAILED", receiptResult);
    persistedReceipts.push(...rows(receiptResult.data));
  }
  if (
    persistedReceipts.length !== receiptIds.length ||
    persistedReceipts.some((row) => text(row.status) !== "SUCCEEDED")
  ) {
    throw new Error("SEO_BCODE_INTERNAL_CORRECTION_RECEIPT_READBACK_MISMATCH");
  }
  const readback = await verifyCorrectionReadback({
    admin,
    ownerId: input.ownerId,
    plan,
    planFingerprint: input.approvedPlanFingerprint,
    ledgerState: "after",
    expectActiveIsolation: true,
  });
  const runResult = await admin
    .from("commerce_operation_runs")
    .select("status,input_snapshot,result_snapshot,finished_at")
    .eq(
      "source_event_id",
      `seo-listing-bcode-correction:${input.approvedPlanFingerprint}`,
    )
    .maybeSingle();
  throwIfError("SEO_BCODE_INTERNAL_CORRECTION_RUN_READBACK_FAILED", runResult);
  if (text(record(runResult.data).status) !== "SUCCEEDED") {
    throw new Error("SEO_BCODE_INTERNAL_CORRECTION_RUN_READBACK_MISMATCH");
  }
  return {
    ok: true,
    planFingerprint: input.approvedPlanFingerprint,
    appliedAt,
    replayed,
    auditReceiptCount: persistedReceipts.length,
    ...readback,
    internalWriteApplied: true,
    externalMarketWrite: false,
    rpcResult: result.data,
  };
}

export async function rollbackSeoListingShoplingBCodeInternalCorrection(input: {
  ownerId: string;
  approvedPlanFingerprint: string;
  now?: Date;
}) {
  if (!PLAN_FINGERPRINT.test(input.approvedPlanFingerprint)) {
    throw new Error("SEO_BCODE_INTERNAL_CORRECTION_PLAN_FINGERPRINT_INVALID");
  }
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const storedResult = await admin
    .from("commerce_operation_runs")
    .select("status,input_snapshot")
    .eq(
      "source_event_id",
      `seo-listing-bcode-correction:${input.approvedPlanFingerprint}`,
    )
    .eq("correlation_id", input.ownerId)
    .maybeSingle();
  throwIfError("SEO_BCODE_INTERNAL_CORRECTION_RUN_READ_FAILED", storedResult);
  const plan = correctionPlan(
    record(storedResult.data).input_snapshot,
    input.ownerId,
    input.approvedPlanFingerprint,
  );
  if (text(record(storedResult.data).status) !== "SUCCEEDED") {
    throw new Error("SEO_BCODE_INTERNAL_CORRECTION_RUN_NOT_APPLIED");
  }
  const rolledBackAt = (input.now ?? new Date()).toISOString();
  const result = await admin.rpc(
    "rollback_seo_listing_bcode_internal_correction_v1",
    {
      p_owner_id: input.ownerId,
      p_plan_fingerprint: input.approvedPlanFingerprint,
      p_rolled_back_at: rolledBackAt,
    },
  );
  throwIfError("SEO_BCODE_INTERNAL_CORRECTION_ROLLBACK_FAILED", result);
  const readback = await verifyCorrectionReadback({
    admin,
    ownerId: input.ownerId,
    plan,
    planFingerprint: input.approvedPlanFingerprint,
    ledgerState: "before",
    expectActiveIsolation: false,
  });
  return {
    ok: true,
    planFingerprint: input.approvedPlanFingerprint,
    rolledBackAt,
    auditReceiptsRetained: true,
    ...readback,
    internalWriteApplied: true,
    externalMarketWrite: false,
    rpcResult: result.data,
  };
}
