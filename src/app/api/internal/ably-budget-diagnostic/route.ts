import { createHash } from "node:crypto";
import {
  ShoplingReadClient,
  shoplingReadConfigFromEnv,
  splitShoplingDateRange,
} from "@/lib/shopling/shoplingReadClient";
import { calendarMonthRange } from "@/lib/monthlyPurchasePolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

function env() {
  return {
    SHOPLING_LOGIN_ID: process.env.SHOPLING_LOGIN_ID,
    SHOPLING_COMPANY_ID: process.env.SHOPLING_COMPANY_ID,
    SHOPLING_API_AUTH_KEY: process.env.SHOPLING_API_AUTH_KEY,
    SHOPLING_PRODUCTS_API_URL: process.env.SHOPLING_PRODUCTS_API_URL,
    SHOPLING_ORDERS_API_URL: process.env.SHOPLING_ORDERS_API_URL,
    SHOPLING_CLAIMS_API_URL: process.env.SHOPLING_CLAIMS_API_URL,
  };
}
function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}
function hint(value: string) {
  return /(?:^|[^a-z])a-?bly(?:[^a-z]|$)|에이블리/i.test(value);
}
function fingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const month = url.searchParams.get("month") || "2026-09";
  const range = calendarMonthRange(month);
  const client = new ShoplingReadClient(shoplingReadConfigFromEnv(env()));
  const chunks = splitShoplingDateRange(range.start, range.end, 7);
  const groups = new Map<string, { mallKey: string; loginHash: string; rowCount: number; orderNos: Set<string>; ablyHint: boolean }>();
  for (const chunk of chunks) {
    const rows = await client.read("orders", chunk);
    for (const value of rows) {
      const row = value as Record<string, unknown>;
      const mallKey = text(row["mall_key"]);
      const loginId = text(row["mall_login_id"]);
      const key = `${mallKey}\u0000${loginId}`;
      const current = groups.get(key) ?? {
        mallKey,
        loginHash: fingerprint(loginId),
        rowCount: 0,
        orderNos: new Set<string>(),
        ablyHint: hint(`${mallKey} ${loginId}`),
      };
      current.rowCount += 1;
      const orderNo = text(row["ord_no"]);
      if (orderNo) current.orderNos.add(orderNo);
      groups.set(key, current);
    }
  }
  return Response.json({
    ok: true,
    month,
    channels: [...groups.values()]
      .map((row) => ({ mallKey: row.mallKey, loginHash: row.loginHash, rowCount: row.rowCount, uniqueOrderCount: row.orderNos.size, ablyHint: row.ablyHint }))
      .sort((a, b) => b.rowCount - a.rowCount),
  }, { headers: { "cache-control": "no-store" } });
}
