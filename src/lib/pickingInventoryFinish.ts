import { isDeepStrictEqual } from "node:util";
import { invoiceGroups, type InvoiceGroups } from "../../shared/mobile-work-center.mjs";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readPickingShare, tokenHash } from "@/lib/pickingShare";
import {
  pickingObservations,
  type PickingObservation,
} from "@/lib/pickingInventoryInput";
import { processUnifiedInventoryBatch } from "@/lib/unifiedInventoryBatch";
import type { InventoryBulkOperationInput } from "@/lib/inventoryStockBulkStore";
import {
  directStockCommandId,
  directStockJobId,
} from "@/lib/shoplingDirectCommand";

const TABLE = "commerce_os_picking_finishes";
type Client = NonNullable<
  Awaited<ReturnType<typeof createSupabaseAdminClient>>
>;
type Ticket = {
  snapshot_id: string;
  dispatch_state: string;
  selections: PickingObservation[];
  finished_at: string;
  invoice_task?: (InvoiceGroups & { status: string; code: string | null }) | null;
};
const ticketFields = "snapshot_id,dispatch_state,selections,finished_at,invoice_task";
export const pickingBatchId = (id: string) => "picking-" + id;

async function loadTicket(db: Client, snapshotId: string) {
  const read = await db
    .from(TABLE)
    .select(ticketFields)
    .eq("snapshot_id", snapshotId)
    .maybeSingle();
  if (read.error) throw new Error("피킹 완료 기록을 조회하지 못했습니다.");
  return read.data as Ticket | null;
}

async function ticketReceipt(db: Client, ticket: Ticket) {
  const sold = ticket.selections.filter((e) => e.soldOut);
  const command = directStockCommandId(pickingBatchId(ticket.snapshot_id));
  const states = new Map<string, string>();
  const waiting = ["queued", "after_invoices"].includes(ticket.dispatch_state);
  if (sold.length && !waiting) {
    const ids = sold.map((e) =>
      directStockJobId(command, e.barcode, "SOLD_OUT"),
    );
    const receipts = await db
      .from("commerce_operation_runs")
      .select("input_snapshot")
      .eq("operation_type", "SHOPLING_STOCK_STATUS_SYNC_EVENT")
      .eq("status", "SUCCEEDED")
      .in("input_snapshot->>jobId", ids)
      .order("started_at", { ascending: true })
      .limit(1000);
    if (
      receipts.error ||
      !Array.isArray(receipts.data) ||
      receipts.data.length >= 1000
    )
      throw new Error("샵플링 접수 결과를 확인하지 못했습니다.");
    for (const { input_snapshot: event } of receipts.data) {
      if (
        event.desiredStatus === "SOLD_OUT" &&
        event.jobId === directStockJobId(command, event.barcode, "SOLD_OUT")
      )
        states.set(
          event.barcode,
          event.outcome === "SUCCEEDED" &&
            event.evidence?.stockPlanComplete !== true
            ? "UNCERTAIN"
            : event.outcome,
        );
    }
  }
  return {
    finishedAt: ticket.finished_at,
    invoiceTask: ticket.invoice_task ? {
      invoiceNumbers: ticket.invoice_task.invoiceNumbers,
      inventoryShortageInvoiceNumbers: ticket.invoice_task.inventoryShortageInvoiceNumbers,
      status: ticket.invoice_task.status, code: ticket.invoice_task.code,
    } : null,
    selections: ticket.selections,
    stockouts: sold.map((e) => ({
      barcode: e.barcode,
      state:
        states.get(e.barcode) ||
        (waiting ? "QUEUED" : "CHECK_PC"),
    })),
  };
}

export async function pickingInventoryReceipt(token: string) {
  const share = await readPickingShare(token);
  if (!share.ok)
    return {
      status: share.status,
      body: { ok: false, message: "목록을 다시 열어 주세요." },
    };
  const db = await createSupabaseAdminClient();
  if (!db) throw new Error("재고 저장소 연결을 확인해 주세요.");
  const ticket = await loadTicket(db, share.value.snapshotId);
  return {
    status: 200,
    body: {
      ok: true,
      receipt: ticket ? await ticketReceipt(db, ticket) : null,
    },
  };
}

export async function finishPickingInventory(
  token: string,
  body: { snapshotId?: unknown; observations?: unknown; invoiceNumbers?: unknown; inventoryShortageInvoiceNumbers?: unknown },
  ownerId?: string,
) {
  const share = await readPickingShare(token);
  if (!share.ok || body.snapshotId !== share.value.snapshotId)
    return {
      status: 409,
      body: {
        ok: false,
        message: "목록이 갱신되었습니다. 최신 카톡 링크를 열어 주세요.",
      },
    };
  const snapshot = share.value;
  const groups = invoiceGroups(body.invoiceNumbers === undefined ? [] : body.invoiceNumbers,
    body.inventoryShortageInvoiceNumbers === undefined ? [] : body.inventoryShortageInvoiceNumbers);
  const hasInvoices = groups.invoiceNumbers.length + groups.inventoryShortageInvoiceNumbers.length > 0;
  if (hasInvoices && !ownerId) throw new Error("4번 업무를 요청할 운영 계정을 확인해 주세요.");
  const matchesInvoices = (ticket: Ticket) =>
    isDeepStrictEqual(ticket.invoice_task?.invoiceNumbers ?? [], groups.invoiceNumbers) &&
    isDeepStrictEqual(ticket.invoice_task?.inventoryShortageInvoiceNumbers ?? [], groups.inventoryShortageInvoiceNumbers);
  const entries = pickingObservations(body.observations, snapshot.items);
  const db = await createSupabaseAdminClient();
  if (!db) throw new Error("재고 저장소 연결을 확인해 주세요.");
  const prior = await loadTicket(db, snapshot.snapshotId);
  if (prior) {
    // Compare fields individually because JSONB returns keys in storage order.
    if (
      !matchesInvoices(prior) ||
      prior.selections.length !== entries.length ||
      entries.some((e, i) => {
        const p = prior.selections[i];
        return (
          p.barcode !== e.barcode ||
          p.quantity !== e.quantity ||
          p.soldOut !== e.soldOut
        );
      })
    )
      return {
        status: 409,
        body: {
          ok: false,
          message:
            "이미 다른 입력으로 완료한 목록입니다. 새로고침해 결과를 확인해 주세요.",
        },
      };
    return {
      status: 200,
      body: { ok: true, receipt: await ticketReceipt(db, prior) },
    };
  }
  const stockoutBarcodes = entries
    .filter((e) => e.soldOut)
    .map((e) => e.barcode);
  if (stockoutBarcodes.length > 50)
    throw new Error(
      "기존 품절 전송 한도는 한 번에 B코드 50개입니다. Ops Center에서 분할 처리해 주세요.",
    );
  const counts = entries
    .filter((e) => !e.soldOut)
    .map((e) => ({ barcode: e.barcode, baselineQuantity: e.quantity }));
  const operations: InventoryBulkOperationInput[] = [];
  const jobs: unknown[] = [];
  const models = new Map<string, string[]>(
    snapshot.items.map((item) => [
      item.barcode,
      [
        ...new Set(
          (item.modelNumbers ?? [])
            .map((m) => m.trim().toUpperCase())
            .filter(Boolean),
        ),
      ],
    ]),
  );
  const occurredAt = new Date().toISOString();
  // All groups are prepared in memory. A later invalid group cancels the entire write.
  let offset = 0;
  let first = true;
  while ((first && stockoutBarcodes.length) || offset < counts.length) {
    const sold = first ? stockoutBarcodes : [];
    const stocktakeItems = counts.slice(offset, offset + 50 - sold.length);
    const prepared = await processUnifiedInventoryBatch(
      {
        batchId: pickingBatchId(snapshot.snapshotId),
        stockoutBarcodes: sold,
        stocktakeItems,
        stockPlanVersion: 1,
        occurredAt,
      },
      async (rows, planned) => {
        operations.push(...rows);
        jobs.push(...planned);
        return {
          requestedCount: rows.length,
          insertedCount: 0,
          duplicateCount: 0,
          sourceEventIds: rows.map((r) => r.sourceEventId),
        };
      },
      models,
    );
    if (!prepared.ok) {
      const rejected = await prepared.json();
      return {
        status: prepared.status,
        body: { ok: false, message: rejected.message },
      };
    }
    first = false;
    offset += stocktakeItems.length;
  }
  const committed = await db.rpc(hasInvoices ? "finish_picking_with_invoices" : "finish_picking_inventory", {
    p_hash: tokenHash(token),
    p_snapshot: snapshot.snapshotId,
    p_version: snapshot.updatedAt,
    p_selections: entries,
    p_operations: operations,
    p_jobs: jobs,
    ...(hasInvoices ? { p_owner: ownerId, p_groups: groups } : {}),
  });
  if (committed.error)
    throw new Error(
      "피킹 완료 결과를 확인하지 못했습니다. 같은 입력으로 다시 확인해 주세요.",
    );
  if (!["saved", "replay"].includes(String(committed.data)))
    return {
      status: 409,
      body: {
        ok: false,
        message:
          "피킹 목록이나 체크가 바뀌었습니다. 최신 목록을 확인해 주세요.",
      },
    };
  // A simultaneous exact replay has a different local timestamp. Its original
  // transaction already owns the ledger rows and the immutable finish receipt.
  for (
    let index = 0;
    committed.data === "saved" && index < operations.length;
    index += 40
  ) {
    const chunk = operations.slice(index, index + 40);
    const result = await db
      .from("commerce_operation_runs")
      .select("source_event_id,operation_type,input_snapshot")
      .in(
        "source_event_id",
        chunk.map((row) => row.sourceEventId),
      )
      .limit(chunk.length + 1);
    const actual = new Map(
      (Array.isArray(result.data) ? result.data : []).map((r) => [
        r.source_event_id,
        r,
      ]),
    );
    if (
      result.error ||
      chunk.some((row) => {
        const recorded = actual.get(row.sourceEventId);
        return (
          recorded?.operation_type !== row.operationType ||
          !isDeepStrictEqual(recorded.input_snapshot, row.snapshot)
        );
      })
    )
      throw new Error(
        "저장된 B코드별 재고 기록을 확인하지 못했습니다. 완료 결과를 다시 조회해 주세요.",
      );
  }
  const receipt = await loadTicket(db, snapshot.snapshotId);
  if (!receipt) throw new Error("저장된 피킹 완료 기록을 확인하지 못했습니다.");
  if (!matchesInvoices(receipt)) return { status: 409, body: { ok: false, message: "이미 다른 송장 목록으로 완료했습니다. 새로고침해 접수 결과를 확인하세요." } };
  return {
    status: 200,
    body: { ok: true, receipt: await ticketReceipt(db, receipt) },
  };
}

const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
    new Date(),
  );

export async function pickingDispatchPending() {
  const db = await createSupabaseAdminClient();
  if (!db) throw new Error("재고 저장소 연결 실패");
  const read = await db
    .from(TABLE)
    .select("snapshot_id")
    .eq("pick_day", today())
    .in("dispatch_state", ["queued", "claimed"])
    .limit(1);
  if (read.error) throw new Error("품절 대기 조회 실패");
  return Array.isArray(read.data) && read.data.length > 0;
}

export async function claimPickingDispatch() {
  const db = await createSupabaseAdminClient();
  if (!db) throw new Error("재고 저장소 연결 실패");
  const active = await db
    .from(TABLE)
    .select(ticketFields)
    .eq("pick_day", today())
    .eq("dispatch_state", "claimed")
    .maybeSingle();
  if (active.error) throw new Error("기존 품절 작업 조회 실패");
  if (active.data) {
    const ticket = active.data as Ticket;
    const receipt = await ticketReceipt(db, ticket);
    if (receipt.stockouts.every((e) => e.state === "SUCCEEDED")) {
      const closed = await db
        .from(TABLE)
        .update({ dispatch_state: "closed" })
        .eq("snapshot_id", ticket.snapshot_id)
        .eq("dispatch_state", "claimed");
      if (closed.error) throw new Error("품절 접수 기록 조회 실패");
    } else if (!receipt.stockouts.every((e) => e.state === "CHECK_PC")) {
      return null;
    }
    // With no STARTED receipt the database can recover an expired desktop lease.
  }
  const claim = await db.rpc("claim_picking_stockout", {});
  if (claim.error) throw new Error("품절 지시 조회 실패");
  return claim.data;
}
