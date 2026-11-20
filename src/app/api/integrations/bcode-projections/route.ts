import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  getProductLaunchAdminConfig,
  readProductLaunchError,
  readResponseJson,
} from "@/lib/productLaunchTrackerServer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function authorized(request: Request) {
  const expected = process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim();
  const supplied = request.headers.get("x-commerce-os-integration-secret")?.trim();
  return Boolean(expected && supplied && expected === supplied);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }
  const raw = await request.text();
  if (raw.length > 8_000) {
    return Response.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "INVALID_JSON" }, { status: 400 });
  }

  const eventId = text(body.eventId);
  const optionBarcodeNo = text(body.optionBarcodeNo);
  const bCode = text(body.bCode).toUpperCase().replace(/\s+/g, "");
  const changedAt = text(body.changedAt) || new Date().toISOString();
  const source = text(body.source) || "product_master";
  if (!eventId || eventId.length > 300 || source.length > 200 || !Number.isFinite(Date.parse(changedAt)) || !/^[0-9]{12}$/.test(optionBarcodeNo) || !/^B[A-Z]{2}[0-9]+-[0-9]+$/.test(bCode)) {
    return Response.json({ ok: false, error: "INVALID_BCODE_PROJECTION" }, { status: 400 });
  }

  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });
  const rpc = await fetch(`${config.value.supabaseUrl}/rest/v1/rpc/apply_option_bcode_projection`, {
    method: "POST",
    headers: {
      ...createSupabaseAdminHeaders(config.value.secretKey),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      p_event_id: eventId,
      p_option_barcode_no: optionBarcodeNo,
      p_b_code: bCode,
      p_source: source,
      p_changed_at: changedAt,
    }),
    cache: "no-store",
  });
  const result = await readResponseJson(rpc);
  if (!rpc.ok) {
    const detail = readProductLaunchError(result, rpc.status);
    const conflict = /CONFLICT|ALREADY_ASSIGNED|CANONICAL/.test(detail);
    return Response.json(
      { ok: false, error: conflict ? "BCODE_PROJECTION_CONFLICT" : "BCODE_PROJECTION_FAILED", message: detail },
      { status: conflict ? 409 : 503 },
    );
  }

  const params = new URLSearchParams({
    select: "owner_id,item_id,option_id,option_barcode_no,barcode",
    option_barcode_no: `eq.${optionBarcodeNo}`,
  });
  const verify = await fetch(`${config.value.supabaseUrl}/rest/v1/product_launch_options?${params}`, {
    headers: createSupabaseAdminHeaders(config.value.secretKey),
    cache: "no-store",
  });
  const rows = await readResponseJson(verify);
  if (!verify.ok || !Array.isArray(rows) || rows.some((row) => {
    const record = row as Record<string, unknown>;
    return text(record.barcode) !== bCode
      || text(record.option_barcode_no) !== optionBarcodeNo;
  })) {
    return Response.json({ ok: false, error: "BCODE_PROJECTION_READBACK_FAILED" }, { status: 409 });
  }

  const ledgerParams = new URLSearchParams({
    select: "option_barcode_no,b_code",
    option_barcode_no: `eq.${optionBarcodeNo}`,
    limit: "1",
  });
  const ledgerVerify = await fetch(`${config.value.supabaseUrl}/rest/v1/option_bcode_projection_ledger?${ledgerParams}`, {
    headers: createSupabaseAdminHeaders(config.value.secretKey),
    cache: "no-store",
  });
  const ledgerRows = await readResponseJson(ledgerVerify);
  const ledger = Array.isArray(ledgerRows) ? ledgerRows[0] as Record<string, unknown> | undefined : undefined;
  if (!ledgerVerify.ok || !ledger || text(ledger.option_barcode_no) !== optionBarcodeNo || text(ledger.b_code) !== bCode) {
    return Response.json({ ok: false, error: "BCODE_PROJECTION_LEDGER_READBACK_FAILED" }, { status: 409 });
  }
  const eventParams = new URLSearchParams({
    select: "event_id,option_barcode_no,b_code",
    event_id: `eq.${eventId}`,
    limit: "1",
  });
  const eventVerify = await fetch(`${config.value.supabaseUrl}/rest/v1/option_bcode_projection_events?${eventParams}`, {
    headers: createSupabaseAdminHeaders(config.value.secretKey),
    cache: "no-store",
  });
  const eventRows = await readResponseJson(eventVerify);
  const event = Array.isArray(eventRows) ? eventRows[0] as Record<string, unknown> | undefined : undefined;
  if (!eventVerify.ok || !event || text(event.option_barcode_no) !== optionBarcodeNo || text(event.b_code) !== bCode) {
    return Response.json({ ok: false, error: "BCODE_PROJECTION_EVENT_READBACK_FAILED" }, { status: 409 });
  }

  return Response.json({
    ok: true,
    result,
    optionBarcodeNo,
    bCode,
    verifiedRows: rows.length,
    ledgerVerified: true,
  });
}
