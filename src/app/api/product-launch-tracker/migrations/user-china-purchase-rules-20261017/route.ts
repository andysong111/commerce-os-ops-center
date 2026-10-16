import { NextRequest } from "next/server";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  getProductLaunchAdminConfig,
  readProductLaunchError,
  readProductLaunchState,
  readResponseJson,
  resolveProductLaunchIdentity,
  writeProductLaunchState,
} from "@/lib/productLaunchTrackerServer";
import { reconcileProductLaunchNormalizedAfterLegacyItems } from "@/lib/productLaunchTrackerNormalizedLegacyReconcile";
import { pushCanonicalProductMasterSnapshotFromTrackerState } from "@/lib/productMasterCanonicalSync";
import type { ProductLaunchTrackerState } from "@/lib/productLaunchTrackerOptimized";
import { prepareUserChinaPurchaseRules20261017 } from "@/lib/userChinaPurchaseRules20261017";

export const runtime = "nodejs";

const TABLE_NAME = "product_launch_tracker_states";
const MIGRATION_KEY = "userChinaPurchaseRules20261017V1";
const MIGRATION_VERSION = "2026-10-17-user-china-purchase-rules-v1";

type R = Record<string, unknown>;
type StoredRow = { state_payload?: unknown; updated_at?: unknown };

export async function GET(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request, { requireSameOrigin: false });
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  try {
    const row = await readProductLaunchState(config.value, identity.value.userId) as StoredRow | null;
    if (!row || !isRecord(row.state_payload)) {
      return Response.json({ ok: false, code: "PRODUCT_LAUNCH_STATE_NOT_FOUND", message: "상품출시진행관리 서버 저장본을 찾지 못했습니다." }, { status: 404 });
    }
    const currentState = row.state_payload as ProductLaunchTrackerState;
    const marker = object(object(currentState.serverMigrations)[MIGRATION_KEY]);
    if (text(marker.status) === "applied") {
      return Response.json({ ok: true, alreadyApplied: true, appliedAt: text(marker.appliedAt), report: marker.report ?? null });
    }

    const prepared = prepareUserChinaPurchaseRules20261017(currentState);
    const apply = request.nextUrl.searchParams.get("apply") === "1";
    if (!apply) return Response.json({ ok: true, dryRun: true, report: prepared.report });
    if (prepared.report.missingModels.length || prepared.report.missingBarcodes.length) {
      return Response.json({
        ok: false,
        code: "USER_CHINA_PURCHASE_RULE_TARGET_MISSING",
        message: "사용자 확정 발주규칙의 모델 또는 B코드를 모두 찾지 못해 적용을 중단했습니다.",
        report: prepared.report,
      }, { status: 409 });
    }

    const appliedAt = new Date().toISOString();
    const nextState: ProductLaunchTrackerState = {
      ...prepared.state,
      savedAt: appliedAt,
      serverMigrations: {
        ...object(prepared.state.serverMigrations),
        [MIGRATION_KEY]: {
          status: "applied",
          version: MIGRATION_VERSION,
          appliedAt,
          source: "사용자 2026-10-17 중국옵션·단종·포장단위·공급처 확정",
          report: prepared.report,
        },
      },
    };
    const saved = await conditionalWriteState(config.value, identity.value, nextState, nullableText(row.updated_at));
    if (!saved) {
      return Response.json({ ok: false, code: "USER_CHINA_PURCHASE_RULE_CONCURRENT_UPDATE", message: "적용 중 다른 저장이 발생했습니다. 다시 실행하세요." }, { status: 409 });
    }

    const changed = new Set(prepared.changedItemIds);
    const affectedItems = Array.isArray(nextState.items)
      ? nextState.items.filter((item) => isRecord(item) && changed.has(text(item.id)))
      : [];
    const [normalized, productMaster] = await Promise.allSettled([
      reconcileProductLaunchNormalizedAfterLegacyItems(config.value, identity.value, prepared.changedItemIds),
      pushCanonicalProductMasterSnapshotFromTrackerState({ schemaVersion: 3, savedAt: appliedAt, items: affectedItems }),
    ]);

    return Response.json({
      ok: true,
      applied: true,
      appliedAt,
      report: prepared.report,
      normalizedSynced: normalized.status === "fulfilled",
      normalizedError: normalized.status === "rejected" ? String(normalized.reason) : null,
      productMasterSynced: productMaster.status === "fulfilled",
      productMasterError: productMaster.status === "rejected" ? String(productMaster.reason) : null,
    });
  } catch (error) {
    return Response.json({
      ok: false,
      code: "USER_CHINA_PURCHASE_RULE_MIGRATION_FAILED",
      message: error instanceof Error ? error.message : "사용자 확정 중국 발주규칙을 적용하지 못했습니다.",
    }, { status: 500 });
  }
}

async function conditionalWriteState(
  config: { supabaseUrl: string; secretKey: string },
  identity: { userId: string; email: string },
  state: ProductLaunchTrackerState,
  previousUpdatedAt: string | null,
) {
  if (!previousUpdatedAt) return writeProductLaunchState(config, identity, state as R) as Promise<StoredRow>;
  const now = new Date().toISOString();
  const params = new URLSearchParams({ owner_id: `eq.${identity.userId}`, updated_at: `eq.${previousUpdatedAt}` });
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${TABLE_NAME}?${params.toString()}`, {
    method: "PATCH",
    headers: { ...createSupabaseAdminHeaders(config.secretKey), Prefer: "return=representation" },
    body: JSON.stringify({ owner_email: identity.email, schema_version: Math.max(3, Math.floor(Number(state.schemaVersion) || 3)), state_payload: state, updated_at: now }),
    cache: "no-store",
  });
  const body = await readResponseJson(response);
  if (!response.ok) throw new Error(readProductLaunchError(body, response.status));
  return Array.isArray(body) ? body[0] as StoredRow | undefined : null;
}

function object(value: unknown): R { return isRecord(value) ? value : {}; }
function isRecord(value: unknown): value is R { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown) { return String(value ?? "").trim(); }
function nullableText(value: unknown) { return text(value) || null; }
