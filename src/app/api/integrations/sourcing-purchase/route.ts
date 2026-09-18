import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { ingestSourcingPurchase } from "@/lib/sourcingPurchaseIngress";

const HEADER = "x-commerce-os-integration-secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function authorized(request: Request) {
  const supplied = request.headers.get(HEADER)?.trim() ?? "";
  const candidates = [
    process.env.SOURCING_ENGINE_INTEGRATION_SECRET,
    process.env.PRODUCT_MASTER_INTEGRATION_SECRET,
    process.env.CHINA_ORDER_MANAGER_INTEGRATION_SECRET,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return Boolean(supplied && candidates.some((candidate) => safeEqual(supplied, candidate)));
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    const configured = Boolean(
      process.env.SOURCING_ENGINE_INTEGRATION_SECRET?.trim() ||
      process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim() ||
      process.env.CHINA_ORDER_MANAGER_INTEGRATION_SECRET?.trim(),
    );
    return NextResponse.json(
      {
        ok: false,
        code: configured
          ? "SOURCING_PURCHASE_INGRESS_UNAUTHORIZED"
          : "SOURCING_PURCHASE_INGRESS_SECRET_REQUIRED",
      },
      {
        status: configured ? 401 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
  try {
    const body = await request.json().catch(() => ({}));
    const result = await ingestSourcingPurchase(body);
    return NextResponse.json(result, {
      status: result.duplicate ? 200 : 201,
      headers: {
        "Cache-Control": "no-store",
        "X-Commerce-OS-Replayed": result.duplicate ? "true" : "false",
      },
    });
  } catch (error) {
    const raw = error instanceof Error ? error.message : "SOURCING_PURCHASE_INGRESS_FAILED";
    const code = raw.split(":", 1)[0] || "SOURCING_PURCHASE_INGRESS_FAILED";
    const conflict = [
      "SOURCING_PURCHASE_MULTIPLE_MONTH_DRAFTS",
      "SOURCING_PURCHASE_MONTH_ALREADY_PROGRESSING",
    ].includes(code);
    return NextResponse.json(
      { ok: false, code, message: raw.slice(0, 500), externalOrderExecuted: false },
      {
        status: conflict ? 409 : code.includes("INVALID") || code.includes("REQUIRED") ? 400 : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
