import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { createSupabaseAdminClient } from "./supabase/admin";
import {
  composeRestock,
  estimatedSmsBytes,
  operatorTestMessage,
  parseRestock,
  RestockInputError,
  restockPhone,
  type RestockDetails,
} from "./restockAlertCore";
import { mobileWorkCenterConfig } from "./mobileWorkCenterAuth";
import { restockCatalog, type RestockProduct } from "./restockAlertCatalog";

const table = "receipt_restock_alerts",
  settings = "receipt_restock_settings";
type Alert = {
  id: string;
  owner_id: string;
  barcode: string | null;
  phone: string;
  last_four: string;
  details: RestockDetails;
  created_at: string;
  status: string;
  draft_id: string | null;
  job_id: string | null;
  attempt_id: string | null;
  attempted_at: string | null;
  sent_body: string | null;
  sender: string | null;
  note: string | null;
};
type Settings = {
  sender: string;
  mode: "off" | "pilot" | "live";
  opt_out: string;
};
const emptySettings: Settings = { sender: "", mode: "off", opt_out: "" };
const uuid = (v: unknown) =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
export const restockNotes: Record<string, string> = {
  CATALOG: "B코드와 자사몰 상품·옵션 연결을 확인해 주세요.",
  STORE: "자사몰에서 해당 옵션을 주문할 수 있는지 다시 확인합니다.",
  SHOPLING: "샵플링 로그인·발신번호·가용 문자 건수를 확인해 주세요.",
  LENGTH: "문자 길이를 확인해 주세요.",
  HISTORY: "샵플링 발송내역을 다시 확인합니다.",
  FAILED: "샵플링에 실패가 표시됐습니다. 고객 수신 여부를 확인해 주세요.",
  AMBIGUOUS: "일치하는 발송 기록을 하나로 확정할 수 없습니다.",
  WAIT: "문자 발송 대기",
};
async function database() {
  const db = await createSupabaseAdminClient();
  if (!db) throw new Error("DATABASE");
  return db;
}
function rows<T>(res: { data: unknown; error: unknown }): T[] {
  if (res.error) throw new Error("DATABASE");
  return Array.isArray(res.data) ? (res.data as T[]) : [];
}
async function getSettings(owner: string) {
  return (
    rows<Settings>(
      await (await database())
        .from(settings)
        .select("sender,mode,opt_out")
        .eq("owner_id", owner)
        .limit(1),
    )[0] ?? emptySettings
  );
}
async function refresh(owner: string) {
  const result = await (
    await database()
  ).rpc("refresh_receipt_restock_alerts", { p_owner: owner });
  if (result.error) throw new Error("DATABASE");
}
export async function restockList(
  owner: string,
  draft: string,
  offset: number,
) {
  const db = await database();
  await refresh(owner);
  const cfg = await getSettings(owner);
  const result = draft
    ? await db.rpc("receipt_restock_draft_page", {
        p_owner: owner,
        p_draft: draft,
        p_offset: offset,
      })
    : await db
        .from(table)
        .select(
          "id,barcode,last_four,status,created_at,draft_id,details,note",
          { count: "exact" },
        )
        .eq("owner_id", owner)
        .order("created_at", { ascending: false })
        .range(offset, offset + 29);
  if (result.error) throw new Error("DATABASE");
  const page = draft
    ? (result.data as { items: Alert[]; total: number })
    : { items: rows<Alert>(result), total: result.count };
  const items = page.items.map((a) => ({
    id: a.id,
    barcode: a.barcode ?? "운영자 시험 문자",
    operatorTest: a.barcode === null,
    phone: "010-****-" + a.last_four,
    market: a.details.marketName,
    marketItem: a.details.marketItem,
    details:
      a.barcode && ["WAITING", "READY"].includes(a.status)
        ? a.details
        : undefined,
    status: a.status,
    created: a.created_at,
    note: restockNotes[a.note || ""] || "",
    draft: a.draft_id,
  }));
  return {
    items,
    total: page.total ?? items.length,
    settings: cfg,
    asOf: new Date().toISOString(),
  };
}
export async function restockDraftSummary(owner: string, draft: string) {
  const db = await database();
  await refresh(owner);
  return rows<{ state: string; total: number }>(
    await db.rpc("receipt_restock_draft_counts", {
      p_owner: owner,
      p_draft: draft,
    }),
  );
}
export async function manageRestock(
  owner: string,
  input: Record<string, unknown>,
) {
  const db = await database();
  if (input.action === "settings") {
    const sender = restockPhone(input.sender),
      optOut = String(input.optOut || "").replace(/[-\s]/g, "");
    const mode = String(input.mode);
    if (
      !["off", "pilot", "live"].includes(mode) ||
      (optOut && !/^080\d{7}$/.test(optOut))
    )
      throw new RestockInputError(
        "발송 모드와 무료수신거부 번호를 확인해 주세요.",
      );
    if (mode === "live") {
      const previous = await db
        .from(table)
        .select("id")
        .eq("owner_id", owner)
        .eq("status", "SENT")
        .eq("sender", sender)
        .eq("evidence->>pilot", "true")
        .limit(1);
      if (!rows(previous).length)
        throw new RestockInputError(
          "이 발신번호로 운영자 시험 문자의 성공 내역을 먼저 확인해 주세요.",
        );
    }
    rows(
      await db
        .from(settings)
        .upsert(
          { owner_id: owner, sender, mode, opt_out: optOut },
          { onConflict: "owner_id" },
        ),
    );
    return;
  }
  if (!uuid(input.id))
    throw new RestockInputError("신청 식별값을 확인해 주세요.");
  if (input.action === "send-test") {
    const phone = restockPhone(input.phone);
    const cfg = await getSettings(owner);
    if (cfg.mode !== "pilot")
      throw new RestockInputError("운영자 시험 모드를 먼저 저장해 주세요.");
    const secret = mobileWorkCenterConfig()?.agentToken;
    if (!secret) throw new Error("CONFIG");
    const res = await db.rpc("request_receipt_restock_test", {
      p_owner: owner,
      p_id: input.id,
      p_sender: cfg.sender,
      p_phone: phone,
      p_hash: seal(
        secret,
        JSON.stringify(["operator-test", owner, input.id, cfg.sender, phone]),
      ),
    });
    if (res.error) throw new Error("DATABASE");
    if (!res.data)
      throw new RestockInputError(
        "발송 설정과 진행 중인 시험 문자 내역을 확인해 주세요.",
      );
    return;
  }
  if (input.action === "cancel") {
    const result = await db
      .from(table)
      .update({
        status: "CANCELED",
        phone: null,
        finished_at: new Date().toISOString(),
        note: null,
      })
      .eq("id", input.id)
      .eq("owner_id", owner)
      .in("status", ["WAITING", "READY"])
      .select("id");
    if (!rows(result).length)
      throw new RestockInputError(
        "발송이 시작되었거나 이미 종료된 신청입니다.",
      );
    return;
  }
  if (input.action === "edit") {
    const existing = rows<Alert>(
      await db
        .from(table)
        .select("barcode,phone,status,details")
        .eq("owner_id", owner)
        .eq("id", input.id)
        .in("status", ["WAITING", "READY"])
        .limit(1),
    )[0];
    if (!existing?.barcode)
      throw new RestockInputError(
        "발송 전 대기 중인 신청만 수정할 수 있습니다.",
      );
    const { details } = parseRestock({
      ...input,
      barcode: existing.barcode,
      phone: existing.phone,
    });
    if (
      details.promotion &&
      existing.details.promotion &&
      !input.rechecked &&
      details.marketPrice === existing.details.marketPrice &&
      details.ownPrice === existing.details.ownPrice &&
      details.marketItem === existing.details.marketItem &&
      details.marketUrl === existing.details.marketUrl &&
      details.marketName === existing.details.marketName
    )
      details.comparedAt = existing.details.comparedAt;
    if (
      estimatedSmsBytes(
        composeRestock(
          details,
          "상품",
          details.storeUrl || "자사몰 링크",
          new Date(),
          "0800000000",
        ),
      ) > 2000
    )
      throw new RestockInputError("문자 길이가 2,000바이트를 넘습니다.");
    const updated = await db
      .from(table)
      .update({ details, note: null, next_check_at: new Date().toISOString() })
      .eq("owner_id", owner)
      .eq("id", input.id)
      .in("status", ["WAITING", "READY"])
      .select("id");
    if (!rows(updated).length)
      throw new RestockInputError("발송이 시작되어 수정할 수 없습니다.");
    return;
  }
  if (input.action !== "register")
    throw new RestockInputError("지원하지 않는 요청입니다.");
  const { barcode, phone, details } = parseRestock(input);
  if (
    estimatedSmsBytes(
      composeRestock(
        details,
        "상품",
        details.storeUrl || "자사몰 링크",
        new Date(),
        "0800000000",
      ),
    ) > 2000
  )
    throw new RestockInputError("문자가 샵플링 한도인 2,000바이트를 넘습니다.");
  const secret = mobileWorkCenterConfig()?.agentToken;
  if (!secret) throw new Error("CONFIG");
  const fingerprint = seal(
    secret,
    JSON.stringify([
      owner,
      input.id,
      barcode,
      phone,
      { ...details, comparedAt: "" },
    ]),
  );
  const result = await db.from(table).insert({
    id: input.id,
    owner_id: owner,
    barcode,
    phone,
    last_four: phone.slice(-4),
    details,
    registration_hash: fingerprint,
  });
  if (result.error?.code === "23505") {
    const existing = rows<{ registration_hash: string }>(
      await db
        .from(table)
        .select("registration_hash")
        .eq("owner_id", owner)
        .eq("id", input.id),
    )[0];
    if (existing?.registration_hash === fingerprint) return;
    throw new RestockInputError(
      "이미 이 번호와 B코드로 대기 중인 신청이 있습니다.",
    );
  }
  rows(result);
}
function seal(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}
function safeEqual(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function hash(body: string) {
  return createHash("sha256").update(body).digest("hex");
}
function proofFor(
  alert: Alert,
  mode: string,
  sender: string,
  expires: number,
  product: RestockProduct | null,
  body: string,
) {
  return JSON.stringify([
    alert.id,
    alert.phone,
    alert.barcode,
    hash(JSON.stringify(alert.details)),
    mode,
    sender,
    expires,
    product
      ? [product.number, product.url, product.name, product.options]
      : null,
    hash(body),
  ]);
}
const deferTime = (minutes: number) =>
  new Date(Date.now() + minutes * 60000).toISOString();
export async function restockWorker(
  owner: string,
  secret: string,
  raw: Record<string, unknown>,
) {
  const db = await database(),
    cfg = await getSettings(owner);
  if (raw.action === "next") {
    await refresh(owner);
    const alert = rows<Alert>(
      await db.rpc("next_receipt_restock_alert", {
        p_owner: owner,
        p_pilot_phone:
          cfg.mode === "live" ? null : cfg.mode === "pilot" ? cfg.sender : "",
      }),
    )[0];
    if (!alert) return { job: null };
    const key = { id: alert.id, phone: alert.phone };
    if (alert.status !== "READY")
      return {
        job: {
          ...key,
          kind: "history",
          sender: alert.sender,
          body: alert.sent_body,
          attempt: alert.attempt_id,
          at: alert.attempted_at,
        },
      };
    let product: RestockProduct | null = null;
    if (alert.barcode !== null) {
      try {
        const starts = rows<{
          input_snapshot: { evidence?: { expected?: string[] } };
        }>(
          await db
            .from("commerce_operation_runs")
            .select("input_snapshot")
            .eq("status", "SUCCEEDED")
            .eq("source", "COMMERCE_OS_INVENTORY_STOCK_CONTROL")
            .eq("operation_type", "SHOPLING_STOCK_STATUS_SYNC_EVENT")
            .eq("correlation_id", "receipt-onsale:" + alert.draft_id)
            .eq("input_snapshot->>jobId", alert.job_id)
            .eq("input_snapshot->>barcode", alert.barcode)
            .eq("input_snapshot->>outcome", "STARTED")
            .limit(2),
        );
        const expected =
          starts.length === 1 && starts[0].input_snapshot.evidence?.expected;
        if (
          !Array.isArray(expected) ||
          !expected.every((id) => /^[A-Z_]+:\d+$/.test(id))
        )
          throw new Error("CATALOG");
        const goodsKeys = [...new Set(expected.map((id) => id.split(":")[1]))];
        product = await restockCatalog(
          alert.barcode,
          alert.details.storeUrl,
          goodsKeys,
        );
      } catch {
        rows(
          await db
            .from(table)
            .update({ note: "CATALOG", next_check_at: deferTime(10) })
            .eq("id", alert.id)
            .eq("owner_id", owner)
            .eq("status", "READY"),
        );
        return { job: null };
      }
    }
    const body = product
      ? composeRestock(
          alert.details,
          product.name,
          product.url,
          new Date(),
          cfg.opt_out,
        )
      : operatorTestMessage;
    const expires = Date.now() + 110000;
    return {
      job: {
        ...key,
        kind: product ? "prepare" : "operator_test",
        sender: cfg.sender,
        body,
        product,
        mode: cfg.mode,
        expires,
        ticket: seal(
          secret,
          proofFor(alert, cfg.mode, cfg.sender, expires, product, body),
        ),
      },
    };
  }
  if (!uuid(raw.id)) throw new RestockInputError("잘못된 작업입니다.");
  const alert = rows<Alert>(
    await db
      .from(table)
      .select("*")
      .eq("owner_id", owner)
      .eq("id", raw.id)
      .limit(1),
  )[0];
  if (!alert) throw new RestockInputError("신청을 찾을 수 없습니다.");
  const base = () => db.from(table);
  if (raw.action === "defer") {
    const note = String(raw.note);
    if (!["STORE", "SHOPLING", "LENGTH"].includes(note))
      throw new RestockInputError("잘못된 보류 사유입니다.");
    rows(
      await base()
        .update({ note, next_check_at: deferTime(5) })
        .eq("id", alert.id)
        .eq("owner_id", owner)
        .eq("status", "READY"),
    );
    return {};
  }
  if (raw.action === "claim") {
    const p = raw.product as RestockProduct | null,
      body = String(raw.body),
      expires = Number(raw.expires),
      bytes = Number(raw.bytes);
    const operatorTest = alert.barcode === null;
    if (operatorTest) {
      if (
        cfg.mode !== "pilot" ||
        alert.sender !== cfg.sender ||
        p !== null ||
        raw.purchasable !== false ||
        body !== operatorTestMessage ||
        bytes > 90
      )
        return { claimed: false };
    } else if (
      !p ||
      !Array.isArray(p.options) ||
      raw.purchasable !== true ||
      (cfg.mode === "pilot" && alert.phone !== cfg.sender) ||
      (body.startsWith("(광고)") &&
        composeRestock(
          alert.details,
          p.name,
          p.url,
          new Date(),
          cfg.opt_out,
        ) !== body)
    ) {
      return { claimed: false };
    }
    if (
      alert.status !== "READY" ||
      cfg.mode === "off" ||
      !Number.isFinite(expires) ||
      expires < Date.now() ||
      expires > Date.now() + 115000 ||
      !Number.isInteger(bytes) ||
      bytes <= 0 ||
      bytes > 2000 ||
      !Number.isSafeInteger(raw.credits) ||
      Number(raw.credits) < (bytes > 90 ? 3 : 1) ||
      !safeEqual(
        String(raw.ticket),
        seal(secret, proofFor(alert, cfg.mode, cfg.sender, expires, p, body)),
      )
    )
      return { claimed: false };
    const attempt = randomUUID();
    const res = await db.rpc("claim_receipt_restock_alert", {
      p_owner: owner,
      p_id: alert.id,
      p_attempt: attempt,
      p_mode: cfg.mode,
      p_sender: cfg.sender,
      p_body: body,
      p_details: alert.details,
      p_evidence: {
        pilot: cfg.mode === "pilot",
        operatorTest,
        product: p?.number ?? null,
        bodyHash: hash(body),
        bytes,
        creditsBefore: raw.credits,
      },
    });
    if (res.error) throw new Error("DATABASE");
    return { claimed: res.data === true, attempt };
  }
  if (
    raw.action !== "history" ||
    !uuid(raw.attempt) ||
    raw.attempt !== alert.attempt_id ||
    !["SENDING", "REVIEW"].includes(alert.status)
  )
    throw new RestockInputError("발송 시도와 대조 결과가 일치하지 않습니다.");
  const outcome = String(raw.outcome);
  const sentAt = String(raw.sentAt || ""),
    elapsed =
      Date.parse(sentAt.replace(" ", "T") + "+09:00") -
      Date.parse(alert.attempted_at!);
  const confirmed =
    outcome === "MATCH" &&
    /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(sentAt) &&
    elapsed >= -2000 &&
    elapsed <= 300000 &&
    /^\d{1,14}$/.test(String(raw.receipt)) &&
    ["단문", "장문"].includes(String(raw.messageType)) &&
    safeEqual(String(raw.bodyHash), hash(alert.sent_body || ""));
  const note =
    outcome === "FAILED"
      ? "FAILED"
      : outcome === "AMBIGUOUS"
        ? "AMBIGUOUS"
        : "HISTORY";
  const update: Record<string, unknown> = confirmed
    ? {
        status: "SENT",
        finished_at: new Date().toISOString(),
        sent_body: null,
        phone: null,
        note: null,
        delivery_key: seal(
          secret,
          JSON.stringify([
            alert.sender,
            alert.phone,
            sentAt,
            hash(alert.sent_body || ""),
          ]),
        ),
        evidence: {
          ...(alert as Alert & { evidence: Record<string, unknown> }).evidence,
          shoplingHistoryNo: String(raw.receipt),
          providerSentAt: sentAt,
          providerMessageType: raw.messageType,
          chargedUnits: raw.messageType === "장문" ? 3 : 1,
          confirmedAt: new Date().toISOString(),
        },
      }
    : {
        status: "REVIEW",
        note,
        next_check_at: deferTime(
          Date.now() - Date.parse(alert.attempted_at!) > 86400000 ? 1440 : 10,
        ),
      };
  const save = (data: Record<string, unknown>) =>
    base()
      .update(data)
      .eq("id", alert.id)
      .eq("owner_id", owner)
      .eq("attempt_id", raw.attempt)
      .in("status", ["SENDING", "REVIEW"]);
  const res = await save(update);
  if (res.error?.code === "23505")
    rows(
      await save({
        status: "REVIEW",
        note: "AMBIGUOUS",
        next_check_at: deferTime(1440),
      }),
    );
  else rows(res);
  return {};
}
