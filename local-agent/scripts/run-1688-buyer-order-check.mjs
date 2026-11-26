import { loadConfig } from "../src/config.mjs";
import { createOpsCenterDraftClient } from "../src/ops-center-draft-client.mjs";
import {
  buyerOrderApiCredentials,
  read1688BuyerOrders,
  reconcile1688BuyerOrderStatuses,
} from "../src/alibaba1688-buyer-order-api.mjs";

const index = process.argv.indexOf("--draft-id");
const draftId = index >= 0 ? String(process.argv[index + 1] ?? "") : "";
const type = "1688-buyer-order-check";

try {
  if (!/^fast-purchase-draft:[a-f0-9]{20}$/.test(draftId)) {
    throw new Error("입고 관리에서 연결할 정확한 발주차시를 선택해 주세요.");
  }
  const config = loadConfig();
  const credentials = buyerOrderApiCredentials();
  if (!credentials) {
    throw Object.assign(new Error("1688 오픈플랫폼 구매자 주문 조회 권한을 연결해 주세요."), {
      code: "ALIBABA1688_BUYER_AUTH_REQUIRED",
    });
  }
  const client = createOpsCenterDraftClient(config);
  const [context, draft] = await Promise.all([client.load1688PaymentContext(draftId), client.loadDraft(draftId)]);
  if (context?.draftId !== draftId || draft?.draftId !== draftId ||
    !Array.isArray(context.expectedRows) || !context.expectedRows.length || !Array.isArray(draft.lines)) {
    throw new Error("선택 차시의 바코드 원본과 발주안이 일치하지 않습니다.");
  }
  const orderNos = [...new Set(context.expectedRows.map((row) => row.orderNo))];
  const orders = await read1688BuyerOrders(orderNos, credentials);
  const result = reconcile1688BuyerOrderStatuses(context.expectedRows, draft.lines, orders);
  console.log(JSON.stringify({ type, ok: true, draftId, ...result, paymentEvidenceRecorded: false }));
  console.log(`결제 상태·품목·수량 일치 ${result.matchedOrderCount}/${result.orderCount}건 · 실결제액 원본 확인 대기`);
} catch (error) {
  console.error(JSON.stringify({
    type, ok: false, draftId,
    code: error?.code ?? "ALIBABA1688_BUYER_ORDER_CHECK_FAILED",
    message: error?.message ?? "1688 구매자 주문을 조회하지 못했습니다.",
  }));
  process.exitCode = 2;
}
