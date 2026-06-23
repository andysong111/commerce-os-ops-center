import { NextResponse } from "next/server";
import { fetchShoplingProductUploadActionsResult } from "@/lib/shoplingProductUploadRunner";

export const runtime = "nodejs";

export async function GET() {
  const result = await fetchShoplingProductUploadActionsResult();
  const statusCode = result.status === "pending" ? 200 : result.status === "error" ? 400 : 200;
  return NextResponse.json(result, { status: statusCode });
}
