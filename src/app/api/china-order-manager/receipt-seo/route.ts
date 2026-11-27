import { requireSeoTitleLedgerContext } from "@/lib/seoTitleLedgerServer";
import { purchaseRunDraftId } from "@/lib/monthlyPriceCore";
import { readReceiptSeoReport } from "@/lib/receiptSeoStore";

export const dynamic = "force-dynamic";
export const maxDuration = 90;
export async function GET(request: Request) {
  const auth = await requireSeoTitleLedgerContext(request);
  if (!auth.ok) return auth.response;
  try {
    const draftId = purchaseRunDraftId(
      new URL(request.url).searchParams.get("draftId"),
    );
    const report = await readReceiptSeoReport(auth.value, draftId);
    return Response.json(
      { ok: true, rows: report.rows },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "입고 SEO 확인 필요",
      },
      { status: 409 },
    );
  }
}
