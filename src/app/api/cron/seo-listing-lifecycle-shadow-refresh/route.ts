import { timingSafeEqual } from "node:crypto";
import { refreshSeoListingLifecycleShadowDaily } from "@/lib/seoListingLifecycleDailyRefreshServer";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request, secret: string) {
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "production") {
    return Response.json(
      { ok: false, code: "PRODUCTION_ONLY" },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return Response.json(
      { ok: false, code: "CRON_SECRET_MISSING" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  if (!authorized(request, secret)) {
    return Response.json(
      { ok: false, code: "UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const admin = await createSupabaseAdminClient();
  if (!admin) {
    return Response.json(
      { ok: false, code: "SUPABASE_ADMIN_NOT_CONFIGURED" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const ownersResult = await admin
      .from("seo_listing_lifecycle_records")
      .select("owner_id")
      .in("state", ["LIVE", "PROTECTED"])
      .limit(2000);
    if (ownersResult.error) {
      throw new Error(`SEO_LIFECYCLE_OWNER_READ_FAILED:${ownersResult.error.message}`);
    }
    const ownerIds = [
      ...new Set(
        (Array.isArray(ownersResult.data) ? ownersResult.data : [])
          .map((row) => text(row.owner_id))
          .filter(Boolean),
      ),
    ];
    const summaries: Array<Record<string, unknown>> = [];
    for (const ownerId of ownerIds) {
      const refresh = await refreshSeoListingLifecycleShadowDaily(ownerId, {
        apply: true,
      });
      summaries.push({
        ownerId,
        generatedAt: refresh.generatedAt,
        productsExamined: refresh.productsExamined,
        recordsExamined: refresh.recordsExamined,
        refreshedRecordCount: refresh.refreshedRecordCount,
        updatedRecordCount: refresh.updatedRecordCount,
        verifiedDayEventCount: refresh.verifiedDayEventCount,
        protectedRecordCount: refresh.protectedRecordCount,
        reviewRecordCount: refresh.reviewRecordCount,
        shadowDueRecordCount: refresh.shadowDueRecordCount,
        insertedShadowActionCount: refresh.insertedShadowActionCount,
      });
    }

    return Response.json(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        ownerCount: ownerIds.length,
        recordsExamined: summaries.reduce(
          (sum, row) => sum + number(row.recordsExamined),
          0,
        ),
        refreshedRecordCount: summaries.reduce(
          (sum, row) => sum + number(row.refreshedRecordCount),
          0,
        ),
        verifiedDayEventCount: summaries.reduce(
          (sum, row) => sum + number(row.verifiedDayEventCount),
          0,
        ),
        shadowDueRecordCount: summaries.reduce(
          (sum, row) => sum + number(row.shadowDueRecordCount),
          0,
        ),
        summaries,
        externalMarketWrite: false,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "SEO_LIFECYCLE_SHADOW_REFRESH_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "자동 물갈이 일일 근거 확인에 실패했습니다.",
        externalMarketWrite: false,
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
