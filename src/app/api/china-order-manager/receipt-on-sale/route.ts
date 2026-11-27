import { claimReceiptOnSale, finishReceiptOnSale, readReceiptOnSaleStatus } from "@/lib/receiptOnSaleStore";
import { resolveProductLaunchIdentity } from "@/lib/productLaunchTrackerServer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "cache-control": "no-store" };
function failure(error: unknown) {
  return Response.json({ ok: false, message: error instanceof Error ? error.message : "입고 전송 원장 확인 필요" }, { status: 409, headers });
}
export async function GET(request: Request) {
  const identity = await resolveProductLaunchIdentity(request, { requireSameOrigin: false });
  if (!identity.ok) return Response.json(identity.body, { status: identity.status, headers });
  try {
    const rows = await readReceiptOnSaleStatus(new URL(request.url).searchParams.get("draftId"));
    return Response.json({ ok: true, rows }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status, headers });
  try {
    const data = await request.json();
    if (data.action === "refresh") return Response.json({ ok: true, rows: await readReceiptOnSaleStatus(data.draftId, true) }, { headers });
    if (data.action === "claim") return Response.json({ ok: true, ...await claimReceiptOnSale(data.draftId, data.jobId) }, { headers });
    if (data.action === "hold") return Response.json({ ok: true, ...await finishReceiptOnSale(data.draftId, { jobId: data.jobId, barcode: data.barcode, outcome: "UNCERTAIN", holdDetached: true, message: "확장 작업 종료 · 원래 전송의 접수증 확인 필요" }) }, { headers });
    if (data.action === "finish") return Response.json({ ok: true, ...await finishReceiptOnSale(data.draftId, data) }, { headers });
    throw new Error("입고 전송 작업을 확인하세요.");
  } catch (error) { return failure(error); }
}
