import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { POST as runLegacyShoplingLaunchBackfill } from "@/app/api/internal/legacy-shopling-launch-backfill/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request, secret: string) {
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "production") {
    return Response.json({ ok: false, error: "Production only" }, { status: 403 });
  }
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return Response.json({ ok: false, error: "CRON_SECRET missing" }, { status: 503 });
  }
  if (!authorized(request, secret)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const mode = request.nextUrl.searchParams.get("mode") === "apply" ? "apply" : "dry-run";
  const origin = new URL(request.url).origin;
  const innerRequest = new NextRequest(
    new URL(`/api/internal/legacy-shopling-launch-backfill?mode=${mode}`, origin),
    {
      method: "POST",
      headers: {
        origin,
        referer: `${origin}/`,
        "content-type": "application/json",
      },
      body: "{}",
    },
  );
  return runLegacyShoplingLaunchBackfill(innerRequest);
}
