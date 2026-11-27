import { handleUnifiedInventoryRequest } from "@/lib/unifiedInventoryBatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;
export const POST = handleUnifiedInventoryRequest;
