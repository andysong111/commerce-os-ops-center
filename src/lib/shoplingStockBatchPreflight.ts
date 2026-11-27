type Status = "ON_SALE" | "SOLD_OUT";
export type StockBatchPlanFields = {
  stockBatchPlan?: string;
  stockBatchDependencies?: string[];
};

type Job = StockBatchPlanFields & {
  barcode: string;
  productKind: "OPTION" | "SINGLE";
  desiredStatus: Status;
  goodsKeys?: string[];
};

export type StockPlanProduct = {
  goodsKey: string;
  partnerGoodsCode: string;
  productName: string;
  productSaleStatus: string;
  options: { barcode: string; selection: {title: string; value: string}[]; optionStatus: string; plannedStatus: string }[];
  beforeAvailability: string | null;
  afterAvailability: string | null;
  finalizeBarcode: string | null;
  parentDesiredStatus: Status | null;
};

export function bindStockBatchPlans<T extends Job>(jobs: readonly T[], result: {
  items?: { barcode: string; productKind: string; desiredStatus: string; dependencies: string[]; stockBatchPlan: string }[];
}) {
  const items = result?.items;
  if (!Array.isArray(items) || items.length !== jobs.length) {
    throw new Error("입력한 B코드 수와 Shopling 전송계획 수가 달라 전송을 중단했습니다.");
  }
  const seen = new Set<string>();
  return jobs.map((job, index) => {
    const item = items[index];
    if (!item || item.barcode !== job.barcode || item.productKind !== job.productKind
      || item.desiredStatus !== job.desiredStatus || !item.stockBatchPlan || typeof item.stockBatchPlan !== "string"
      || seen.has(job.barcode) || !Array.isArray(item.dependencies)
      || item.dependencies.some((barcode) => !seen.has(barcode))) {
      throw new Error(`${job.barcode}의 전송 순서 또는 상품·옵션 계획이 입력과 일치하지 않습니다.`);
    }
    seen.add(job.barcode);
    return { ...job, stockBatchPlan: item.stockBatchPlan, stockBatchDependencies: item.dependencies };
  });
}

export async function preflightShoplingStockJobs<T extends Job>(jobs: readonly T[]) {
  const response = await fetch("/api/inventory-stock-control/shopling-option-status", {
    method: "POST", cache: "no-store", headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "PREFLIGHT_BATCH", items: jobs.map(({ barcode, productKind, desiredStatus, goodsKeys }) =>
      ({ barcode, productKind, desiredStatus, goodsKeys })) }),
  });
  const payload = await response.json();
  if (!response.ok || payload?.ok !== true) {
    throw new Error(String(payload?.message || "Shopling 상품·옵션 사전 조회에 실패했습니다."));
  }
  return { jobs: bindStockBatchPlans(jobs, payload.result), products: payload.result.products as StockPlanProduct[] };
}

// Keep an existing signed command's original finalizing B-code and expiry.
// If two independent commands touch the same product, their projected ends
// can disagree; the operator can submit those B-codes together as one command.
export function retainQueueCommandPlans<T extends Job & { retransmissionRequestId?: string }>(
  saved: readonly T[], fresh: readonly T[], products: readonly Pick<StockPlanProduct, "options" | "goodsKey" | "productSaleStatus">[],
): T[] {
  if (saved.length !== fresh.length) throw new Error("운영 큐 전송계획 수가 일치하지 않습니다.");
  const byBarcode = new Map(saved.map((job) => [job.barcode, job]));
  for (const product of products) {
    if (product.productSaleStatus === "E") continue;
    const scopes = new Set<string>();
    for (const option of product.options) {
      const job = byBarcode.get(option.barcode);
      if (!job) continue;
      if (job.stockBatchPlan && !job.retransmissionRequestId) throw new Error("저장된 상품 전송계획의 요청 번호를 확인하지 못했습니다.");
      scopes.add(job.stockBatchPlan ? "saved:" + job.retransmissionRequestId : "current-run");
    }
    if (scopes.size > 1) throw new Error(`상품번호 ${product.goodsKey}에 서로 다른 전송 요청이 겹칩니다. 해당 B코드를 통합 입력에 함께 넣어 새 계획을 작성해 주세요.`);
  }
  return saved.map((job, i) => {
    if (fresh[i].barcode !== job.barcode || fresh[i].desiredStatus !== job.desiredStatus) throw new Error("운영 큐의 상품 전송계획 순서가 변경되었습니다.");
    return job.stockBatchPlan ? job : fresh[i];
  });
}

// Queue priority may reorder options with the same timestamp after a refresh.
// Restore a saved command's prerequisite order without pulling extra work into it.
export function orderStockBatchJobs<T extends Job & { retransmissionRequestId?: string }>(jobs: readonly T[]): T[] {
  const pending = [...jobs];
  const ordered: T[] = [];
  while (pending.length) {
    const index = pending.findIndex((job) => !(job.stockBatchDependencies || []).some((prior) =>
      pending.some((other) => other.barcode === prior && other.retransmissionRequestId === job.retransmissionRequestId)));
    if (index < 0) throw new Error("저장된 상품·옵션 전송 순서를 검증하지 못했습니다.");
    ordered.push(pending.splice(index, 1)[0]);
  }
  return ordered;
}

export function missingStockPlanReceipts(job: Job, completed: ReadonlySet<string>) {
  if (!job.stockBatchPlan || !Array.isArray(job.stockBatchDependencies)) {
    throw new Error(`${job.barcode}의 Shopling 상품·옵션 계획을 확인할 수 없습니다.`);
  }
  return job.stockBatchDependencies.filter((barcode) => !completed.has(barcode));
}

export function stockPlanReceiptSummary(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const evidence = value as Record<string, unknown>;
  const accepted = evidence.stockPlanComplete === true ? evidence.stockStateGroupReceipts : evidence.completedStockPlanLegs;
  const remaining = evidence.remainingTransmissionGroups;
  function describe(groups: unknown) {
    if (!Array.isArray(groups)) return "";
    const labels: string[] = [];
    for (const [kind, label] of [["OPTION_SEND", "옵션"], ["PRODUCT_SALE_STATUS_SEND", "상품상태"]]) {
      const count = groups.filter((group) => group?.transmissionKind === kind).length;
      if (count) labels.push(`${label} ${count}회`);
    }
    return labels.join(" · ");
  }
  return [[describe(accepted), "접수 확인"], [describe(remaining), "접수 미확인"]]
    .filter(([lanes]) => lanes).map(([lanes, label]) => `${label} · ${lanes}`).join(" / ");
}

// A per-popup success can arrive while another planned leg is pending. Only
// the extension's aggregate, after it matched every original receipt, can
// complete this B-code and unlock another option on the same product.
export function verifyStockPlanTerminal<T extends { outcome: "SUCCEEDED" | "FAILED" | "UNCERTAIN"; message?: string; evidence?: unknown }>(result: T): T {
  if (result.outcome !== "SUCCEEDED") return result;
  const evidence = result.evidence && typeof result.evidence === "object"
    ? result.evidence as Record<string, unknown> : {};
  if (evidence.stockPlanComplete === true) return result;
  return { ...result, outcome: "UNCERTAIN", message: "전체 옵션·상품 전송계획에 해당하는 접수 영수증을 확인하지 못했습니다.",
    evidence: { ...evidence, code: "SHOPLING_STOCK_PLAN_RECEIPT_INCOMPLETE", retrySafe: false } };
}
