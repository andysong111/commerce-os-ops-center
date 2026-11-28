import {
  mobileWorkCenterConfig,
  verifyMobileWorkCenterOwner,
} from "@/lib/mobileWorkCenterAuth";
import {
  manageRestock,
  restockDraftSummary,
  restockList,
} from "@/lib/restockAlertStore";
import { RestockInputError, storeProductNumber } from "@/lib/restockAlertCore";
import { loadIndexedShoplingGoodsKeys } from "@/lib/shopling/shoplingBcodeIndex";
import { restockCatalog } from "@/lib/restockAlertCatalog";
import { restockMarketQuote } from "@/lib/restockMarketQuoteStore";
export const dynamic = "force-dynamic";
export const maxDuration = 45;
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
async function handle(request: Request, write: boolean) {
  const cfg = mobileWorkCenterConfig();
  if (!cfg) return json({ error: "운영 계정 연결이 필요합니다." }, 503);
  const access = await verifyMobileWorkCenterOwner(cfg.ownerId);
  if (access !== 200)
    return json({ error: "운영 계정으로 로그인해 주세요." }, access);
  const url = new URL(request.url);
  try {
    if (write) {
      if (
        request.headers.get("origin") !== url.origin ||
        !request.headers.get("content-type")?.startsWith("application/json")
      )
        return json({ error: "요청 출처를 확인해 주세요." }, 403);
      const content = await request.text();
      if (content.length > 6000)
        return json({ error: "입력이 너무 깁니다." }, 413);
      let input;
      try {
        input = JSON.parse(content);
      } catch {
        return json({ error: "입력을 확인해 주세요." }, 400);
      }
      if (!input || typeof input !== "object" || Array.isArray(input))
        return json({ error: "입력을 확인해 주세요." }, 400);
      if (input.action === "quote") {
        if (
          typeof input.barcode !== "string" ||
          !/^B[A-Z]{1,2}\d+-\d+$/.test(input.barcode)
        )
          return json({ error: "B코드를 확인해 주세요." }, 400);
        return json(
          await restockMarketQuote(
            cfg.ownerId,
            input.barcode,
            true,
            input.retry === true,
          ),
        );
      }
      await manageRestock(cfg.ownerId, input);
      return json({ ok: true });
    }
    if (url.searchParams.has("offer")) {
      const barcode = url.searchParams.get("offer") || "";
      if (!/^B[A-Z]{1,2}\d+-\d+$/.test(barcode))
        return json({ error: "B코드를 확인해 주세요." }, 400);
      return json(await restockMarketQuote(cfg.ownerId, barcode));
    }
    if (url.searchParams.has("lookup")) {
      const barcode = url.searchParams.get("lookup") || "",
        store = url.searchParams.get("store") || "";
      if (
        !/^B[A-Z]{1,2}\d+-\d+$/.test(barcode) ||
        (store && !storeProductNumber(store))
      )
        return json({ product: null });
      try {
        return json({
          product: await restockCatalog(
            barcode,
            store,
            await loadIndexedShoplingGoodsKeys(barcode),
            false,
          ),
        });
      } catch {
        return json({ product: null });
      }
    }
    const draft = url.searchParams.get("draft") || "",
      offset = Number(url.searchParams.get("offset") || 0);
    if (
      (draft && !/^fast-purchase-draft:[a-f0-9]{20}$/.test(draft)) ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    )
      return json({ error: "차시 또는 페이지를 확인해 주세요." }, 400);
    if (url.searchParams.has("summary") && draft)
      return json({ counts: await restockDraftSummary(cfg.ownerId, draft) });
    return json(await restockList(cfg.ownerId, draft, offset));
  } catch (e) {
    return e instanceof RestockInputError
      ? json({ error: e.message }, 409)
      : json({ error: "입고알림 원장 연결을 확인해 주세요." }, 503);
  }
}
export const GET = (r: Request) => handle(r, false);
export const POST = (r: Request) => handle(r, true);
