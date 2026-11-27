import { loadInternalChinaFreightBarcodeCompletion } from "@/lib/internalChinaFreightBarcodeCompletion";
import { loadStoredInternalChinaForwarderClose } from "@/lib/internalChinaForwarderStoredClose";
import { recordForwarderInvoice, validInvoiceAmount } from "@/lib/internalChinaForwarderInvoice";
import { resolveProductLaunchIdentity } from "@/lib/productLaunchTrackerServer";

export async function POST(request: Request) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const input = await request.json().catch(() => null);
  if (!/^fast-purchase-draft:[a-f0-9]{20}$/.test(input?.draftId ?? "") || !validInvoiceAmount(input?.amountKrw)) {
    return Response.json({ ok: false, message: "차시와 청구액(1~10억 원)을 확인하세요." }, { status: 400 });
  }
  try {
    const [completion, closed] = await Promise.all([
      loadInternalChinaFreightBarcodeCompletion(input.draftId),
      loadStoredInternalChinaForwarderClose(input.draftId),
    ]);
    if (!completion || closed || completion.cycleMonth !== input.cycleMonth || completion.evidenceHash !== input.evidenceHash) {
      throw new Error("INVOICE_CONFLICT");
    }
    const invoice = await recordForwarderInvoice(completion, input.amountKrw, input.previousRevision);
    return Response.json({ ok: true, invoice });
  } catch (error) {
    const conflict = error instanceof Error && error.message === "INVOICE_CONFLICT";
    return Response.json({ ok: false, message: conflict
      ? "차시 또는 청구액이 변경됐습니다. 새로고침 후 확인하세요."
      : "청구액 저장 여부를 확인하지 못했습니다. 새로고침 후 다시 확인하세요." }, { status: conflict ? 409 : 503 });
  }
}
