import { NextRequest } from "next/server";
import { resolveProductLaunchIdentity } from "@/lib/productLaunchTrackerServer";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const secret = process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim();
  const base = (process.env.PRODUCT_MASTER_BASE_URL?.trim() || "https://commerce-os-product-master.vercel.app").replace(/\/$/, "");
  if (!secret || !/^https:\/\//.test(base)) {
    return Response.json({ ok: false, error: "PRODUCT_MASTER_INTEGRATION_NOT_CONFIGURED" }, { status: 503 });
  }
  const body = await request.text();
  if (body.length > 4_000) return Response.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  const response = await fetch(`${base}/api/integrations/aaa022-bde7-reconciliation`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-commerce-os-integration-secret": secret,
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(240_000),
  });
  const result = await response.json().catch(() => ({ ok: false, error: "PRODUCT_MASTER_INVALID_RESPONSE" }));
  return Response.json(result, { status: response.status });
}
