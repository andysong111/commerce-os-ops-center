import { GET as readQueue } from "./handler";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import { withInventoryReadGuard } from "@/lib/inventoryStockReadGuard";
export { POST } from "./handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isSameOriginOpsRequest(request)) return readQueue(request);
  // No successful job cache: execution always observes a newly read ledger.
  return withInventoryReadGuard("queue", () => readQueue(request));
}
