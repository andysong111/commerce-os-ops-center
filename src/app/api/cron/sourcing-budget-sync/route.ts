import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  StorageSourcingBudgetSyncError,
  syncPreviousMonthRevenueToStorage,
} from "@/lib/storageSourcingBudgetSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(request: Request, secret: string) {
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json(
      { ok: false, error: "SOURCING_BUDGET_SYNC_PRODUCTION_ONLY" },
      { status: 403 },
    );
  }
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET_NOT_CONFIGURED" },
      { status: 503 },
    );
  }
  if (!authorized(request, secret)) {
    return NextResponse.json(
      { ok: false, error: "CRON_UNAUTHORIZED" },
      { status: 401 },
    );
  }
  try {
    const result = await syncPreviousMonthRevenueToStorage();
    return NextResponse.json({
      ok: true,
      budgetMonth: result.budgetMonth,
      sourceMonth: result.sourceMonth,
      revenueKrw: result.revenueKrw,
      availableSpendWon: result.availableSpendWon,
      monthlyBudgetWon: result.monthlyBudgetWon,
      monthlyItemCap: result.monthlyItemCap,
      changed: result.changed,
    });
  } catch (error) {
    if (error instanceof StorageSourcingBudgetSyncError) {
      console.error("[sourcing-budget-sync] failed", {
        code: error.code,
        status: error.status,
        message: error.message,
      });
      return NextResponse.json(
        { ok: false, error: error.code, message: error.message },
        { status: error.status },
      );
    }
    console.error("[sourcing-budget-sync] unexpected failure", error);
    return NextResponse.json(
      { ok: false, error: "SOURCING_BUDGET_SYNC_FAILED" },
      { status: 500 },
    );
  }
}
