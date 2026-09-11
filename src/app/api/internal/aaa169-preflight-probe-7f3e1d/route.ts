import { prepareLegacySeoPreflight } from "@/lib/legacySeoPreflight";
import { getProductLaunchAdminConfig } from "@/lib/productLaunchTrackerServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const ITEM_ID = "044cf0ea-70eb-4904-9cc6-2756a48f8662";
const OWNER_ID = "0c23a96b-1cda-44b6-9c08-1fa1c1b45a36";

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return Response.json({ ok: false, code: "PREVIEW_ONLY" }, { status: 404 });
  }

  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  const result = await prepareLegacySeoPreflight({
    config: config.value,
    identity: { userId: OWNER_ID, email: "andy0801a@gmail.com" },
    itemIds: [ITEM_ID],
  });

  return Response.json({
    ok: result.ok,
    requestedCount: result.requestedCount,
    readyCount: result.readyCount,
    excludedCount: result.excludedCount,
    failedCount: result.failedCount,
    issueCount: result.issueCount,
    optionSyncError: result.optionSyncError,
    canonicalPriceError: result.canonicalPriceError,
    canonicalBatch: result.canonicalPrice?.batch ?? null,
    optionSync: result.optionSync ?? null,
    canonicalPrice: result.canonicalPrice ?? null,
    results: result.results,
  }, { status: result.ok ? 200 : 422 });
}
