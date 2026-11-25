import { loadInternalChinaFreightBarcodeCompletion, loadInternalChinaFreightBarcodeReceiptEvidence } from "@/lib/internalChinaFreightBarcodeCompletion";
import { loadStoredInternalChinaForwarderClose } from "@/lib/internalChinaForwarderStoredClose";
import { INTERNAL_CHINA_PURCHASE_PREP_OPERATION_TYPE } from "@/lib/internalChinaMonthlyPurchaseSummary";
import { create1688PaymentEvidence, INTERNAL_CHINA_PAYMENT_SOURCE_PREFIX, read1688PaymentEvidence } from "@/lib/internalChinaPaymentEvidence";
import { resolveProductLaunchIdentity } from "@/lib/productLaunchTrackerServer";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadChinaOrderLedger } from "@/lib/chinaOrderLedger";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });

  try {
    const body = await request.json();
    const draftId = String(body?.draftId ?? "");
    const completion = await loadInternalChinaFreightBarcodeCompletion(draftId);
    if (!completion || completion.evidenceHash !== body?.barcodeEvidenceHash) {
      throw new Error("PAYMENT_BARCODE_VERSION_CONFLICT");
    }
    const [barcodeEvidence, storedClose, admin, ledger] = await Promise.all([
      loadInternalChinaFreightBarcodeReceiptEvidence(completion),
      loadStoredInternalChinaForwarderClose(draftId),
      createSupabaseAdminClient(),
      loadChinaOrderLedger(),
    ]);
    if (storedClose) throw new Error("PAYMENT_ALREADY_CLOSED");
    if (ledger.error) throw new Error("PAYMENT_STORE_UNAVAILABLE");
    const reserved = new Set(ledger.commitments.filter(row =>
      row.sourceSystem === "fast-purchase-mvp" && row.sourceRunId === draftId
    ).map(row => row.barcode));
    if (barcodeEvidence.lines.some(line => !reserved.has(line.barcode))) {
      throw new Error("PAYMENT_DRAFT_BARCODE_CONFLICT");
    }

    if (!admin) throw new Error("PAYMENT_STORE_UNAVAILABLE");
    const evidence = create1688PaymentEvidence({
      draftId,
      cycleMonth: completion.cycleMonth,
      barcodeEvidenceHash: completion.evidenceHash,
      originalRows: body.rows,
      grandTotalCny: body.grandTotalCny,
      expected: barcodeEvidence.lines,
    });
    const sourceEventId = INTERNAL_CHINA_PAYMENT_SOURCE_PREFIX + draftId;
    const now = new Date().toISOString();
    const write = await admin.from("commerce_operation_runs").upsert({
        operation_type: INTERNAL_CHINA_PURCHASE_PREP_OPERATION_TYPE,
        status: "SUCCEEDED",
        source: "ops-center-1688-payment-evidence",
        source_event_id: sourceEventId,
        correlation_id: `purchase-run:${draftId}`,
        actor_type: "OPS_OPERATOR",
        input_snapshot: { draftId, cycleMonth: evidence.cycleMonth, paymentEvidenceHash: evidence.paymentEvidenceHash },
        result_snapshot: evidence,
        started_at: now,
        updated_at: now,
        finished_at: now,
    }, { onConflict: "source_event_id", ignoreDuplicates: true });
    if (write.error) throw new Error("PAYMENT_STORE_FAILED");
    const result = await admin.from("commerce_operation_runs")
      .select("result_snapshot")
      .eq("source_event_id", sourceEventId)
      .maybeSingle();
    const row = result.data as { result_snapshot?: Record<string, unknown> } | null;
    if (result.error || !row?.result_snapshot) throw new Error("PAYMENT_READBACK_FAILED");
    const saved = read1688PaymentEvidence(row.result_snapshot, sourceEventId);
    if (saved?.paymentEvidenceHash !== evidence.paymentEvidenceHash) {
      throw new Error("PAYMENT_ALREADY_RECORDED");
    }
    return Response.json({ ok: true, paidTotalCny: saved.paidTotalFen / 100 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "PAYMENT_STORE_FAILED";
    const [code, detail] = reason.split(":");
    const messages: Record<string, string> = {
      PAYMENT_BARCODE_VERSION_CONFLICT: "바코드 완료 원본을 확인할 수 없습니다. 화면을 새로고침하세요.",
      PAYMENT_BARCODE_ORDER_INVALID: "바코드 원본에 유효한 1688 주문번호와 수량이 필요합니다.",
      PAYMENT_DRAFT_BARCODE_CONFLICT: "이 발주차시 원장에 없는 B-code가 바코드 원본에 포함되어 있습니다.",
      PAYMENT_ORDER_QUANTITY_CONFLICT: `주문번호·B-code·수량이 바코드 원본과 다릅니다. ${detail ?? ""}`,
      PAYMENT_LINE_INVALID_OR_DUPLICATE: `중복 또는 잘못된 결제 줄을 확인하세요. ${detail ?? ""}`,
      PAYMENT_ROW_INVALID: `결제 자료 ${detail ?? ""}번째 줄의 6개 열을 확인하세요.`,
      PAYMENT_ROWS_INVALID: "결제 자료를 붙여넣고 다시 확인하세요.",
      PAYMENT_CNY_INVALID: "1688 실결제 총액을 위안으로 입력하세요.",
      PAYMENT_GRAND_TOTAL_CONFLICT: "각 행의 상품대금·운임·1688 서비스비 합계가 입력한 실결제 총액과 다릅니다.",
      PAYMENT_ALREADY_CLOSED: "배송대행 비용이 마감된 차시입니다. 기존 원가를 확인하세요.",
      PAYMENT_ALREADY_RECORDED: "이 발주차시에 다른 내용의 실결제 자료가 이미 기록되어 있습니다.",
    };
    return Response.json({
      ok: false,
      message: messages[code] ?? "실결제 자료를 확인하지 못했습니다. 새로고침 후 등록 상태를 확인하세요.",
    }, { status: messages[code] ? 409 : 503 });
  }
}
