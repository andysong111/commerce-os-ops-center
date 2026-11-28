import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "./supabase/admin";
import { loadIndexedShoplingGoodsKeys } from "./shopling/shoplingBcodeIndex";
import { normalizeShoplingBcode } from "./shopling/shoplingBcodeIndexCore";
import { readShoplingStockVariants } from "./shopling/shoplingOptionStatus";
import {
  rankRestockOffers,
  type MarketQuote,
  type QuoteTarget,
  type QuoteView,
} from "./restockMarketOffer";

const table = "receipt_restock_market_quotes";
const freshMs = 120_000;
const waitMs = 180_000;
type Row = {
  barcode: string;
  ticket: string;
  requested_at: string;
  finished_at: string | null;
  targets: QuoteTarget[] | null;
  result: MarketQuote | null;
};
async function database() {
  const db = await createSupabaseAdminClient();
  if (!db) throw new Error("QUOTE_DATABASE");
  return db;
}
function state(row: Row | null): QuoteView {
  if (!row) return { state: "unavailable" };
  const age = Date.now() - Date.parse(row.requested_at);
  if (!row.finished_at)
    return { state: age < waitMs ? "pending" : "unavailable" };
  return age < waitMs + freshMs &&
    Date.now() - Date.parse(row.finished_at) < freshMs &&
    row.result?.complete
    ? { state: "ready", result: row.result }
    : { state: "unavailable" };
}

export async function restockMarketQuote(
  owner: string,
  barcode: string,
  request = false,
  retry = false,
): Promise<QuoteView> {
  if (!/^B[A-Z]{1,2}\d+-\d+$/.test(barcode)) throw new Error("QUOTE_BARCODE");
  const db = await database();
  const select = () =>
    db
      .from(table)
      .select("*")
      .eq("owner_id", owner)
      .eq("barcode", barcode)
      .maybeSingle();
  const saved = await select();
  if (saved.error) throw new Error("QUOTE_DATABASE");
  const row = saved.data as Row | null;
  const view = state(row);
  if (!request || view.state !== "unavailable") return view;
  // A failed or timed-out read must not repeatedly hold a ready notification.
  if (
    row &&
    !retry &&
    (row.finished_at
      ? Date.now() - Date.parse(row.finished_at) < freshMs
      : Date.now() - Date.parse(row.requested_at) < waitMs + freshMs)
  )
    return view;
  const job = {
    ticket: randomUUID(),
    requested_at: new Date().toISOString(),
    finished_at: null,
    targets: null,
    result: null,
  };
  const write = row
    ? await db
        .from(table)
        .update(job)
        .eq("owner_id", owner)
        .eq("barcode", barcode)
        .eq("ticket", row.ticket)
    : await db
        .from(table)
        .upsert(
          { ...job, owner_id: owner, barcode },
          { onConflict: "owner_id,barcode", ignoreDuplicates: true },
        );
  if (write.error) throw new Error("QUOTE_DATABASE");
  return { state: "pending" };
}

async function eligibleTargets(barcode: string): Promise<QuoteTarget[]> {
  const keys = await loadIndexedShoplingGoodsKeys(barcode);
  if (!keys.length || keys.length > 100) throw new Error("QUOTE_INDEX");
  const variants = await readShoplingStockVariants(keys);
  const targets: QuoteTarget[] = [];
  for (const goodsKey of keys) {
    const rows = variants.filter(
      (v) =>
        v.goodsKey === goodsKey &&
        normalizeShoplingBcode(v.partnerOptionCode) === barcode,
    );
    if (rows.length > 1) throw new Error("QUOTE_AMBIGUOUS");
    const row = rows[0];
    if (
      !row ||
      /^0+$/.test(row.optionQuantity) ||
      row.productSaleStatus !== "B" ||
      row.optionStatus !== "B"
    )
      continue;
    if (
      row.optionAdjustment === undefined ||
      !Number.isSafeInteger(row.optionAdjustment)
    )
      throw new Error("QUOTE_OPTION_PRICE");
    targets.push({ goodsKey, adjustment: row.optionAdjustment });
  }
  return targets;
}

export async function workRestockQuote(
  owner: string,
  input: Record<string, unknown>,
) {
  const db = await database();
  const pending = () =>
    db
      .from(table)
      .select("*")
      .eq("owner_id", owner)
      .is("finished_at", null)
      .gt("requested_at", new Date(Date.now() - waitMs).toISOString());
  if (input.action === "quote-next") {
    const item = await pending().order("requested_at").limit(1).maybeSingle();
    if (item.error) throw new Error("QUOTE_DATABASE");
    const row = item.data as Row | null;
    if (!row) return { job: null };
    let targets: QuoteTarget[];
    try {
      targets = row.targets ?? (await eligibleTargets(row.barcode));
    } catch {
      const done = await db
        .from(table)
        .update({ finished_at: new Date().toISOString() })
        .eq("owner_id", owner)
        .eq("ticket", row.ticket)
        .is("finished_at", null);
      if (done.error) throw new Error("QUOTE_DATABASE");
      return { job: null };
    }
    const changed = await db
      .from(table)
      .update(
        targets.length
          ? { targets }
          : {
              targets,
              finished_at: new Date().toISOString(),
              result: rankRestockOffers([], []),
            },
      )
      .eq("owner_id", owner)
      .eq("ticket", row.ticket)
      .is("finished_at", null)
      .select("ticket")
      .maybeSingle();
    if (changed.error) throw new Error("QUOTE_DATABASE");
    return {
      job:
        changed.data && targets.length
          ? { ticket: row.ticket, keys: targets.map((t) => t.goodsKey) }
          : null,
    };
  }
  const ticket = String(input.ticket ?? "");
  if (!/^[a-f0-9-]{36}$/.test(ticket)) throw new Error("QUOTE_TICKET");
  const found = await pending().eq("ticket", ticket).maybeSingle();
  if (found.error) throw new Error("QUOTE_DATABASE");
  const row = found.data as Row | null;
  if (!row?.targets) return {};
  const result = rankRestockOffers(row.targets, input.observations);
  const saved = await db
    .from(table)
    .update({ result, finished_at: new Date().toISOString() })
    .eq("owner_id", owner)
    .eq("ticket", ticket)
    .is("finished_at", null);
  if (saved.error) throw new Error("QUOTE_DATABASE");
  return {};
}
