import { GET as readOverview } from "./handler";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import { withInventoryReadGuard } from "@/lib/inventoryStockReadGuard";
export { POST } from "./handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export async function GET(request: Request) {
  // Preserve authorization before consulting the failure circuit. POST is never
  // cached, retried, or wrapped; the original stock-fact handler is unchanged.
  if (!isSameOriginOpsRequest(request)) return readOverview(request);
  return withInventoryReadGuard("overview", () => readOverview(request));
}
