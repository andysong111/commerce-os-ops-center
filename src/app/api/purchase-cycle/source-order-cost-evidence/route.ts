import { NextRequest } from "next/server";
import {
  importOctober2026SourceOrderCostEvidence,
  loadOctober2026SourceOrderCostEvidencePreview,
} from "@/lib/october2026SourceOrderPurchaseCostEvidence";
import { resolveProductLaunchIdentity } from "@/lib/productLaunchTrackerServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const CONFIRMATION = "IMPORT_SOURCE_ORDER_PURCHASE_COST_EVIDENCE_23";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store, max-age=0" },
  });
}

function safeMessage(error: unknown) {
  return (error instanceof Error
    ? error.message
    : "SOURCE_ORDER_COST_EVIDENCE_FAILED"
  )
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 1000);
}

export async function GET(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return json(identity.body, identity.status);
  try {
    return json({
      ok: true,
      preview: await loadOctober2026SourceOrderCostEvidencePreview(),
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: "SOURCE_ORDER_COST_EVIDENCE_PREVIEW_FAILED",
        message: safeMessage(error),
      },
      503,
    );
  }
}

export async function POST(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return json(identity.body, identity.status);
  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (
    !body ||
    Object.keys(body).some(
      (key) => !["confirmation", "expectedImportFingerprint"].includes(key),
    )
  ) {
    return json(
      {
        ok: false,
        error: "SOURCE_ORDER_COST_EVIDENCE_REQUEST_INVALID",
        message: "승인문구와 미리보기 지문만 보낼 수 있습니다.",
      },
      400,
    );
  }
  if (String(body.confirmation ?? "") !== CONFIRMATION) {
    return json(
      {
        ok: false,
        error: "SOURCE_ORDER_COST_EVIDENCE_CONFIRMATION_REQUIRED",
        message: "23건 구매원가 근거 수입에 대한 정확한 승인문구가 필요합니다.",
      },
      400,
    );
  }
  try {
    const result = await importOctober2026SourceOrderCostEvidence(
      body.expectedImportFingerprint,
    );
    return json({
      ok: true,
      result,
      priceWritesEnabled: false,
      inventoryWritesEnabled: false,
      receiptWritesEnabled: false,
      actualPurchaseEnabled: false,
    });
  } catch (error) {
    const message = safeMessage(error);
    const changed = message.includes("PRECONDITION_CHANGED");
    const invalid = message.includes("INVALID");
    return json(
      {
        ok: false,
        error: changed
          ? "SOURCE_ORDER_COST_EVIDENCE_PRECONDITION_CHANGED"
          : invalid
            ? "SOURCE_ORDER_COST_EVIDENCE_REQUEST_INVALID"
            : "SOURCE_ORDER_COST_EVIDENCE_IMPORT_FAILED",
        message,
        priceWritesEnabled: false,
        inventoryWritesEnabled: false,
        receiptWritesEnabled: false,
        actualPurchaseEnabled: false,
      },
      changed ? 409 : invalid ? 400 : 502,
    );
  }
}
