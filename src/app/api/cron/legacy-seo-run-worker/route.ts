import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processLegacySeoRunQueue } from "@/lib/legacySeoRunWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request, secret: string) {
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json(
      { ok: false, error: "이전상품 SEO worker는 Production에서만 실행됩니다." },
      { status: 403 },
    );
  }
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET 설정이 필요합니다." },
      { status: 503 },
    );
  }
  if (!authorized(request, secret)) {
    return NextResponse.json(
      { ok: false, error: "이전상품 SEO worker 인증에 실패했습니다." },
      { status: 401 },
    );
  }

  try {
    const workerId = `legacy-seo-cron:${process.env.VERCEL_REGION || "unknown"}:${randomUUID()}`;
    const result = await processLegacySeoRunQueue({
      workerId,
      maxJobs: 2,
      timeBudgetMs: 240_000,
    });
    const busy = result.claimedCount > 0 || result.queuedCount > 0;
    return NextResponse.json({ ok: true, busy, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        busy: true,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
