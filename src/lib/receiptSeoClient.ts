import type { ReceiptSeoResult } from "./receiptSeoPortfolio";
import {
  createHandoffToken,
  handoffToExtension,
  probeExtension,
} from "./seoMarketBrowserBridge";

const marketApi = "/api/shopling-market-auto-orchestration";
type Mode = "full_pipeline" | "market_only";
type ReceiptIntent = {
  runIds: string[];
  batchId: string;
  handoff?: {
    ids: string[];
    mode: Mode;
    token: string;
    delivered?: boolean;
    submitted?: boolean;
  };
};
function key(draftId: string) {
  return "commerceOs.receiptSeo.v1." + draftId;
}
function save(draftId: string, intent: ReceiptIntent) {
  window.localStorage.setItem(key(draftId), JSON.stringify(intent));
}
export function hasReceiptSeoIntent(draftId: string) {
  return !!window.localStorage.getItem(key(draftId));
}

class ReceiptRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function json(url: string, body?: Record<string, unknown>) {
  const res = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...(body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await res.json();
  if (!res.ok || data.ok !== true)
    throw new ReceiptRequestError(
      data.message || "입고 SEO 요청을 확인하세요.",
      res.status,
    );
  return data;
}
export async function fetchReceiptSeo(
  draftId: string,
): Promise<ReceiptSeoResult[]> {
  const data = await json(
    "/api/china-order-manager/receipt-seo?draftId=" +
      encodeURIComponent(draftId),
  );
  if (!Array.isArray(data.rows))
    throw new Error("입고 SEO 조회 결과를 확인하세요.");
  return data.rows;
}
export async function advanceReceiptSeo(
  draftId: string,
  rows: ReceiptSeoResult[],
  start: boolean,
) {
  const advance = async () => {
    const stored = window.localStorage.getItem(key(draftId));
    let intent: ReceiptIntent;
    if (!stored) {
      if (!start) return "";
      const runIds = [
        ...new Set(
          rows
            .filter((r) => ["NEW", "READY", "RESUME"].includes(r.state))
            .map((r) => r.runId),
        ),
      ];
      if (!runIds.length) return "현재 등록 가능한 입고 상품이 없습니다.";
      intent = { runIds, batchId: "seo-bulk-receipt-" + crypto.randomUUID() };
      save(draftId, intent);
    } else {
      intent = JSON.parse(stored) as ReceiptIntent;
      if (
        !Array.isArray(intent.runIds) ||
        !intent.runIds.length ||
        !intent.batchId
      )
        throw new Error("저장된 입고 SEO 실행 기록을 확인하세요.");
    }
    const handoff = intent.handoff;
    if (handoff) {
      const payload = {
        receiptDraftId: draftId,
        runIds: handoff.ids,
        handoffToken: handoff.token,
        mode: handoff.mode,
      };
      const { handoff: original } = await json(marketApi, {
        ...payload,
        action: "receipt_handoff_status",
      });
      if (original?.terminal) {
        if (original.state !== "completed") {
          window.localStorage.removeItem(key(draftId));
          return (
            original.error ||
            "기존 전송에 확인할 항목이 있습니다. 마켓별 접수 결과를 확인하세요."
          );
        }
        const rest = intent.runIds.filter((id) => !handoff.ids.includes(id));
        if (rest.length)
          save(draftId, { runIds: rest, batchId: intent.batchId });
        else window.localStorage.removeItem(key(draftId));
        return rest.length
          ? "마켓전송 완료 · 나머지 입고 상품 확인 중"
          : "선택한 입고 상품의 마켓전송 완료";
      }
      if (original?.activeAgent)
        return "확장프로그램에서 원래 마켓전송 작업을 처리하고 있습니다.";
      if (handoff.delivered) return "원래 마켓전송 결과 확인 중";
      if (!(await probeExtension()))
        return "Shopling 전송 확장 연결 대기 · 연결 후 기존 작업을 이어갑니다.";
      if (!original && handoff.submitted && !start)
        return "원래 등록 요청 결과를 확인 중입니다. 필요하면 기존 작업 이어가기를 누르세요.";
      if (!original) {
        handoff.submitted = true;
        save(draftId, intent);
      }
      let result = original;
      if (!result) {
        try {
          result = await json(marketApi, {
            ...payload,
            action:
              handoff.mode === "market_only" ? "create_market_only" : "create",
          });
        } catch (error) {
          if (error instanceof ReceiptRequestError && error.status === 409) {
            const recovered = await json(marketApi, {
              ...payload,
              action: "receipt_handoff_status",
            });
            if (!recovered.handoff) {
              const rest = intent.runIds.filter(
                (id) => !handoff.ids.includes(id),
              );
              if (rest.length)
                save(draftId, { batchId: intent.batchId, runIds: rest });
              else window.localStorage.removeItem(key(draftId));
            }
          }
          throw error;
        }
      }
      if (
        !result.orchestrationId ||
        (!original && result.handoffToken !== handoff.token)
      )
        throw new Error("원래 마켓전송 작업을 확인하세요.");
      if (await handoffToExtension(result.orchestrationId, handoff.token)) {
        handoff.delivered = true;
        save(draftId, intent);
        return "입고 상품을 기존 마켓전송 대기열에 전달했습니다.";
      }
      throw new Error(
        "확장프로그램 인계 확인 대기 · 원래 작업으로 이어갑니다.",
      );
    }
    const selected = [
      ...new Map(
        rows
          .filter((r) => r.runId && intent.runIds.includes(r.runId))
          .map((r) => [r.runId, r]),
      ).values(),
    ];
    const fresh = selected.filter((r) => r.state === "NEW");
    if (fresh.length) {
      const runs = fresh.map((r) => ({
        id: r.itemId,
        runId: r.runId,
        batchId: intent.batchId,
        autoQueueShoplingRegistration: false,
      }));
      let data;
      try {
        data = await json("/api/seo-run-jobs", {
          action: "enqueue",
          receiptDraftId: draftId,
          batchId: intent.batchId,
          runs,
        });
      } catch (error) {
        if (
          error instanceof ReceiptRequestError &&
          [409, 422].includes(error.status)
        ) {
          const remaining = intent.runIds.filter(
            (id) => !fresh.some((r) => r.runId === id),
          );
          if (remaining.length)
            save(draftId, { runIds: remaining, batchId: intent.batchId });
          else window.localStorage.removeItem(key(draftId));
        }
        throw error;
      }
      const accepted = new Set(
        (data.jobs ?? []).map((j: { run_id: string }) => j.run_id),
      );
      const missed = fresh.filter((r) => !accepted.has(r.runId));
      if (missed.length) {
        const remaining = intent.runIds.filter(
          (id) => !missed.some((r) => r.runId === id),
        );
        if (remaining.length)
          save(draftId, { runIds: remaining, batchId: intent.batchId });
        else window.localStorage.removeItem(key(draftId));
        return (
          [...(data.excluded ?? []), ...(data.missing ?? [])].join(" · ") ||
          "일부 입고 상품의 SEO 자료를 확인하세요."
        );
      }
      return "SEO 대량등록 대기열에서 상품 자료를 준비하고 있습니다.";
    }
    const resume = selected.filter((r) => r.state === "RESUME"),
      ready = selected.filter((r) => r.state === "READY");
    const batch = resume.length ? resume : ready;
    if (batch.length) {
      intent.handoff = {
        ids: batch.map((r) => r.runId),
        mode: resume.length ? "market_only" : "full_pipeline",
        token: createHandoffToken(),
      };
      save(draftId, intent);
      return advance();
    }
    if (selected.some((r) => r.state === "ACTIVE"))
      return "기존 SEO 작업 처리 중";
    window.localStorage.removeItem(key(draftId));
    return selected.length === intent.runIds.length &&
      selected.every((r) => r.state === "DONE")
      ? "선택한 입고 상품의 마켓 등록 확인 완료"
      : "입고 또는 등록 상태가 바뀌었습니다. B코드별 결과를 확인하세요.";
  };
  if (!navigator.locks) return advance();
  return navigator.locks.request(key(draftId), { ifAvailable: true }, (lock) =>
    lock
      ? advance()
      : Promise.resolve("다른 창에서 같은 입고 차시를 처리하고 있습니다."),
  );
}
