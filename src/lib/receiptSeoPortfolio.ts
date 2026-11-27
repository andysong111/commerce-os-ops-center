import { marketOnlyLedgerSafety } from "./shoplingMarketAutoResumePolicy.ts";
import { createHash } from "node:crypto";
import { SEO_LISTING_SHADOW_EXPECTED_PROFILES } from "./seoListingLifecycleReconciliation.ts";
import {
  freshCodeRelistReady,
  planSeoScheduledPortfolioRun,
} from "./seoListingScheduledRun.ts";
import type { MonthlyPriceItem, MonthlyPriceRun } from "./monthlyPriceStore";

type Row = Record<string, unknown>;
export type ReceiptSeoLine = {
  draftId: string;
  barcode: string;
  quantity: number;
  receiptId: string;
  receivedAt: number;
  legacyPreview?: boolean;
  priceReady: boolean;
  saleReady: boolean;
  goodsKeys?: string[];
};
export type ReceiptSeoCard = {
  id: string;
  codes: string[];
  model: string;
  name: string;
  materialError: string;
  excluded?: string;
  priorUpload: boolean;
  goodsKeys: string[];
};
export type ReceiptSeoStep =
  | "HOLD"
  | "NEW"
  | "READY"
  | "RESUME"
  | "ACTIVE"
  | "DONE";
export type ReceiptSeoResult = {
  barcode: string;
  quantity: number;
  itemId: string;
  model: string;
  draftId: string;
  runId: string;
  state: ReceiptSeoStep;
  reason: string;
  rotation: string;
  markets: number;
};
export type ReceiptSeoBudget = {
  marketLimit: number;
  marketObservedAt: string;
  productLimit: number;
  productObservedAt: string;
};
export type ReceiptSeoReport = {
  rows: ReceiptSeoResult[];
  coveredItemIds: string[];
  dispatchBudget?: ReceiptSeoBudget;
};
export function receiptSeoRecord(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
}
const text = (value: unknown) => String(value ?? "").trim();
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const profiles = new Set<string>(SEO_LISTING_SHADOW_EXPECTED_PROFILES);
const marketSent = (value: unknown) =>
  value === "sent" || value === "already_registered";
const sent = (row: Row) =>
  marketSent(row.status) && marketSent(row.market_status);

export function receiptSeoRunId(owner: string, card: string, previousRun = "") {
  const hash = createHash("sha256")
    .update(JSON.stringify([owner, card, previousRun]))
    .digest("hex");
  return "seo-run-receipt-" + hash;
}

// The prior run is part of the receipt job's identity. Only that successor may advance the old exposure round.
export function receiptSeoSuccessors(
  owner: string,
  history: Row[],
  jobs: Row[],
  now: Date,
) {
  const result = new Map<string, { previousRun: string; runId: string }>();
  for (const job of jobs) {
    const runId = text(job.run_id),
      id = text(job.launch_item_id);
    if (
      !runId.startsWith("seo-run-receipt-") ||
      job.registration_status !== "success"
    )
      continue;
    const rows = history.filter(
      (r) => r.launch_item_id === id && r.owner_id === owner,
    );
    const previousRun = text(rows[0]?.current_run_id);
    if (!previousRun || runId !== receiptSeoRunId(owner, id, previousRun))
      continue;
    const keys = array(
      receiptSeoRecord(job.registration_payload).goodsKeys,
    ).map(text);
    if (
      keys.length !== profiles.size ||
      new Set(keys).size !== profiles.size ||
      rows.some(
        (r) =>
          !profiles.has(text(r.market_account_key)) ||
          keys.includes(text(r.goods_key)),
      )
    )
      continue;
    if (
      freshCodeRelistReady(
        {
          launchItemId: id,
          runId,
          modelNumber: "",
          productName: "",
          runCreatedAt: text(job.run_created_at),
        },
        rows,
        now,
      )
    )
      result.set(id, { previousRun, runId });
  }
  return result;
}

export function receiptSeoPriceReady(
  target: { barcode: string; receiptId: string; quantity: number },
  draftId: string,
  price: { run: MonthlyPriceRun | null; items: MonthlyPriceItem[] },
  verifiedKeeps: Set<string>,
) {
  const run = price.run;
  const cost = run?.source_snapshot.costs.find(
    (c) => c.barcode === target.barcode,
  );
  if (
    !run ||
    !cost ||
    run.source_snapshot.draftId !== draftId ||
    cost.draftId !== draftId ||
    cost.provenance !== "CONFIRMED_RECEIPT_AND_CLOSED_COST" ||
    cost.quantity !== target.quantity ||
    !cost.receiptIds.includes(target.receiptId)
  )
    return false;
  const expected = run.source_snapshot.candidates.filter((c) =>
    c.options.some((o) => o.barcode === target.barcode),
  );
  if (!expected.length) return false;
  return expected.every((c) => {
    const item = price.items.find(
      (i) => i.goods_key === c.goodsKey && i.run_id === run.id,
    );
    if (
      !item ||
      item.error_code ||
      !item.candidate.options.some((o) => o.barcode === target.barcode)
    )
      return false;
    if (item.state === "HELD" && !item.plan) return verifiedKeeps.has(item.id);
    if (
      item.plan?.goodsKey !== c.goodsKey ||
      !item.plan?.fingerprint ||
      item.plan.policy !== run.policy_version
    )
      return false;
    if (item.state === "HELD") return item.plan.writes.length === 0;
    return (
      item.state === "TRANSMITTED" &&
      !!item.transmission?.finishedAt &&
      item.transmission.result ===
        "RESULT_WINDOW_FINISHED_MARKET_CONFIRMATION_PENDING"
    );
  });
}

export function buildReceiptSeoReport(input: {
  owner: string;
  lines: ReceiptSeoLine[];
  cards: ReceiptSeoCard[];
  jobs: Row[];
  lifecycle: Row[];
  ledger: Row[];
  registry: Row[];
  isolatedIds: Set<string>;
  marketSlots: number;
  productSlots: number;
  now: Date;
  verifiedUploads: Map<string, { itemId: string; goodsKeys: string[] }>;
  draftId?: string;
}): ReceiptSeoReport {
  const byCode = new Map<string, ReceiptSeoCard[]>();
  for (const card of input.cards)
    for (const code of new Set(card.codes)) {
      const cards = byCode.get(code) ?? [];
      cards.push(card);
      byCode.set(code, cards);
    }
  const latest = new Map<string, ReceiptSeoLine>();
  for (const line of input.lines) {
    const old = latest.get(line.barcode);
    if (
      !old ||
      old.receivedAt < line.receivedAt ||
      (old.receivedAt === line.receivedAt && old.receiptId < line.receiptId)
    )
      latest.set(line.barcode, line);
  }
  const source = input.draftId
    ? input.lines.filter((line) => line.draftId === input.draftId)
    : [...latest.values()];
  const covered = new Set<string>();
  const groups = new Map<string, ReceiptSeoResult[]>();
  const rows = source.map((line) => {
    const cards = byCode.get(line.barcode) ?? [];
    cards.forEach((c) => covered.add(c.id));
    const card = cards.length === 1 ? cards[0] : undefined;
    const row: ReceiptSeoResult = {
      barcode: line.barcode,
      quantity: line.quantity,
      itemId: card?.id ?? "",
      model: card?.model ?? "",
      draftId: line.draftId,
      runId: "",
      state: "HOLD",
      markets: 0,
      rotation: "입고 목록 편입 · 카드 연결 대기",
      reason: card
        ? ""
        : cards.length
          ? "여러 출시 카드에 같은 B코드가 있습니다."
          : "연결할 출시 카드가 없습니다.",
    };
    if (card) {
      const group = groups.get(card.id) ?? [];
      group.push(row);
      groups.set(card.id, group);
      row.rotation = "입고 목록 편입 · 마켓 이력 대기";
      if (latest.get(line.barcode)?.receiptId !== line.receiptId)
        row.reason = "최근 재입고 차시에서 진행합니다.";
      else if (!line.priceReady)
        row.reason = "이 입고분의 가격조정 또는 가격 유지 결과 대기";
      else if (!line.saleReady)
        row.reason = "이 입고분의 판매중 전송 접수 대기";
    }
    return row;
  });
  let marketSlots = Math.max(0, input.marketSlots),
    productSlots = Math.max(0, input.productSlots);
  for (const id of [...groups.keys()].sort()) {
    const group = groups.get(id)!;
    const card = byCode.get(group[0].barcode)![0];
    const history = input.lifecycle.filter((r) => r.launch_item_id === id);
    const registry = input.registry.filter((r) => r.launch_item_id === id);
    const jobs = input.jobs
      .filter((r) => r.launch_item_id === id)
      .sort(
        (a, b) =>
          text(b.run_created_at).localeCompare(text(a.run_created_at)) ||
          text(b.run_id).localeCompare(text(a.run_id)),
      );
    const job = jobs[0],
      activeJob = job && !job.archived_at ? job : undefined;
    const cycleKeys = new Set(
      history.map((r) => text(r.goods_key)).filter(Boolean),
    );
    const jobKeys = array(
      receiptSeoRecord(job?.registration_payload).goodsKeys,
    ).map(text);
    const keys = new Set(
      card.goodsKeys.length
        ? card.goodsKeys
        : jobKeys.length
          ? jobKeys
          : cycleKeys.size
            ? cycleKeys
            : registry.map((r) => text(r.goods_key)),
    );
    const evidenceKeys = new Set([
      ...keys,
      ...card.codes.flatMap((code) => latest.get(code)?.goodsKeys ?? []),
    ]);
    const ownerConflict = [
      ...input.registry,
      ...input.ledger,
      ...input.lifecycle,
    ].some(
      (r) => evidenceKeys.has(text(r.goods_key)) && r.launch_item_id !== id,
    );
    const conflict =
      ownerConflict ||
      (job?.registration_status === "success" &&
        jobKeys.length > 0 &&
        card.goodsKeys.length > 0 &&
        (keys.size !== jobKeys.length || jobKeys.some((k) => !keys.has(k))));
    const allLedger = input.ledger.filter((r) => r.launch_item_id === id);
    const ledger = allLedger.filter((r) => keys.has(text(r.goods_key)));
    const profileCount = new Set(
      history
        .filter((r) => profiles.has(text(r.market_account_key)))
        .map((r) => r.market_account_key),
    ).size;
    const uniqueMarket = (profile: string) => {
      const lines = ledger.filter((r) => r.profile === profile);
      return lines.length === 1 && sent(lines[0]);
    };
    const completed = [...profiles].filter(uniqueMarket).length;
    const profileStates: Record<string, string> = {
      LIVE: "노출",
      PROTECTED: "판매 보호",
      COOLDOWN: "휴지",
      RETIRE_CANDIDATE: "종료 검토",
      EXCEPTION: "확인 필요",
      READY: "대기",
    };
    const states = [
      ...new Set(
        history.map((r) => profileStates[text(r.state)] || "확인 필요"),
      ),
    ].join("·");
    for (const row of group) {
      row.markets = completed;
      if (history.length)
        row.rotation = `기존 물갈이 이력 연결 · ${profileCount}/6 · ${states}`;
    }
    const result = (state: ReceiptSeoStep, reason: string, runId = "") => {
      for (const row of group) Object.assign(row, { state, reason, runId });
    };
    if (conflict) {
      result(
        "HOLD",
        "입고 B코드와 기존 마켓 상품코드의 연결이 일치하지 않습니다.",
      );
      continue;
    }
    if (card.excluded) {
      result("HOLD", card.excluded);
      continue;
    }
    if (input.isolatedIds.has(id)) {
      result("HOLD", "출시 카드 격리 사유 확인 필요");
      continue;
    }
    const predecessors = new Set(
      history.map((r) => text(r.current_run_id)).filter(Boolean),
    );
    const relist =
      history.length === 6 &&
      history.every((r) => r.state === "COOLDOWN") &&
      predecessors.size === 1;
    if (
      completed === 6 &&
      keys.size === 6 &&
      !relist &&
      !history.some(
        (r) =>
          ["EXCEPTION", "RETIRE_CANDIDATE"].includes(text(r.state)) ||
          r.requires_review === true,
      )
    ) {
      result("DONE", "6개 마켓 그룹의 기존 등록 확인", text(job?.run_id));
      continue;
    }
    if (group.some((r) => r.reason)) {
      for (const row of group)
        if (!row.reason) row.reason = "같은 상품의 입고 옵션 확인 대기";
      continue;
    }
    if (
      card.codes.some(
        (code) => (byCode.get(code)?.length ?? 0) > 1 && latest.has(code),
      )
    ) {
      result(
        "HOLD",
        "같은 상품에 출시 카드 연결이 모호한 입고 옵션이 있습니다.",
      );
      continue;
    }
    // An older draft cannot start a product-wide operation while a sibling option is being received again.
    if (
      card.codes.some((code) => {
        const l = latest.get(code);
        return l && (!l.priceReady || !l.saleReady);
      })
    ) {
      result(
        "HOLD",
        "같은 상품의 최근 입고 옵션이 가격·판매중 확인 대기입니다.",
      );
      continue;
    }
    const canRelist = relist && history.every((r) => !r.requires_review);
    if (
      history.some(
        (r) =>
          r.state === "PROTECTED" || (r.state === "COOLDOWN" && !canRelist),
      )
    ) {
      result("HOLD", "기존 판매 보호·휴지 이력 유지");
      continue;
    }
    if (
      history.some(
        (r) =>
          r.requires_review === true ||
          ["EXCEPTION", "RETIRE_CANDIDATE"].includes(text(r.state)),
      )
    ) {
      result("HOLD", "기존 물갈이 이력 확인 필요");
      continue;
    }
    const jobForRound =
      activeJob && (!canRelist || !predecessors.has(text(activeJob.run_id)))
        ? activeJob
        : undefined;
    if (jobForRound?.registration_status === "success") {
      if (canRelist) {
        const fresh =
          jobKeys.length === 6 && jobKeys.every((key) => !cycleKeys.has(key));
        if (!fresh) {
          result("HOLD", "이전 회차와 새 상품코드의 연결 확인 필요");
          continue;
        }
        if (completed === 6 && keys.size === 6) {
          result(
            "DONE",
            "새 상품코드의 6개 마켓 등록 확인 · 새 노출 회차 확인 중",
            text(jobForRound.run_id),
          );
          continue;
        }
      }
      const proof = input.verifiedUploads.get(
        text(jobForRound.registration_job_id),
      );
      if (
        keys.size !== 6 ||
        !proof ||
        proof.itemId !== id ||
        proof.goodsKeys.some((k) => !keys.has(k)) ||
        !marketOnlyLedgerSafety([...keys], ledger).safe ||
        ledger.some(
          (r) =>
            marketSent(r.status) !== marketSent(r.market_status) ||
            !profiles.has(text(r.profile)) ||
            ["claimed", "submit_armed", "confirm_needed"].some(
              (s) => r.status === s || r.market_status === s,
            ),
        )
      ) {
        result("HOLD", "기존 마켓 전송 접수·상품코드 확인 필요");
        continue;
      }
      if (marketSlots <= 0) {
        result("HOLD", "남은 마켓 등록 자리 확인 대기");
        continue;
      }
      --marketSlots;
      result(
        "RESUME",
        `기존 업로드에서 남은 마켓 전송 이어가기 · ${completed}/6`,
        text(jobForRound.run_id),
      );
      continue;
    }
    if (
      !canRelist &&
      (keys.size ||
        registry.length ||
        allLedger.length ||
        card.priorUpload ||
        history.length)
    ) {
      result("HOLD", "기존 등록 이력 연결·검증 대기");
      continue;
    }
    if (
      jobForRound &&
      (jobForRound.status === "failed" ||
        jobForRound.status === "cancelled" ||
        jobForRound.registration_status === "failed")
    ) {
      result(
        "HOLD",
        "기존 SEO 작업의 실패 원인 확인 필요",
        text(jobForRound.run_id),
      );
      continue;
    }
    if (
      jobForRound &&
      !(
        jobForRound.status === "ready" &&
        jobForRound.registration_status === "idle"
      )
    ) {
      result(
        "ACTIVE",
        "기존 SEO 생성·등록 작업 처리 중",
        text(jobForRound.run_id),
      );
      continue;
    }
    if (job && !activeJob && !canRelist) {
      result("HOLD", "보관된 SEO 작업 이력 확인 필요");
      continue;
    }
    if (card.materialError) {
      result("HOLD", card.materialError);
      continue;
    }
    const runId = jobForRound
      ? text(jobForRound.run_id)
      : receiptSeoRunId(input.owner, id, canRelist ? [...predecessors][0] : "");
    const plan = planSeoScheduledPortfolioRun({
      readyProducts: [
        {
          launchItemId: id,
          runId,
          modelNumber: card.model,
          productName: card.name,
          runCreatedAt: jobForRound
            ? text(jobForRound.run_created_at)
            : input.now.toISOString(),
        },
      ],
      lifecycleRows: history,
      safeBatchCount: marketSlots,
      capacityBlocked: marketSlots <= 0,
      shoplingProductDbSafeNewProductCount: productSlots,
      now: input.now,
    });
    if (!plan.selectedProducts.length) {
      result(
        "HOLD",
        plan.excludedByLifecycleCount
          ? "기존 물갈이 주기·삭제 확인 대기"
          : "마켓 또는 Shopling 상품코드 자리 확인 대기",
      );
      continue;
    }
    --marketSlots;
    --productSlots;
    result(
      jobForRound ? "READY" : "NEW",
      jobForRound ? "기존 SEO 작업으로 등록 가능" : "SEO 대량등록 준비 완료",
      runId,
    );
  }
  for (const row of rows) {
    if (
      source.some((line) => line.barcode === row.barcode && line.legacyPreview)
    ) {
      row.rotation = row.rotation.replace("입고 목록 편입", "이전 차시 조회");
      if (row.state !== "DONE") {
        row.state = "HOLD";
        row.runId = "";
        row.reason = "상시 편입 도입 전 입고 차시 · 기존 등록 이력 조회";
      }
    }
  }
  return {
    rows: rows.sort((a, b) => a.barcode.localeCompare(b.barcode)),
    coveredItemIds: [...covered],
  };
}
