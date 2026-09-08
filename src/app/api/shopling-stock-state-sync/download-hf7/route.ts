import { GET as getBaseDownload } from "../download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOTFIX = "HF7_A21_DIRECT_PRICE_ROW_CHECKBOX_STALE_POPUP_RECOVERY";
const MODE = "A6_READ_ONLY_BCODE_GOODSKEYS_THEN_API_STATUS_THEN_A21_DIRECT_PRICE_ROW_CHECKBOX_WITH_STALE_POPUP_RECOVERY_HF7";

export async function GET(request: Request) {
  const baseResponse = await getBaseDownload(request);
  const url = new URL(request.url);

  if (url.searchParams.get("verify") === "1") {
    const payload = await baseResponse.json() as Record<string, unknown>;
    return Response.json({
      ...payload,
      hotfix: HOTFIX,
      mode: MODE,
      a21NativeHeaderSelectRequired: false,
      a21SelectionCompatibility: "PRICE_EXTENSION_ROW_CHECKBOX_CLICK_THEN_CHECKED_TRUE_THEN_INPUT_CHANGE",
      a21SelectionVerification: "ALL_EXACT_RESULT_ROWS_CHECKED_BEFORE_MODIFY_SEND",
      stalePopupRecovery: "A21_POPUP_WITHOUT_REAL_POPUP_AFTER_5S_RETURNS_TO_A21_LIST",
      liveShoplingVerified: false,
    }, { headers: { "cache-control": "no-store" } });
  }

  const headers = new Headers(baseResponse.headers);
  headers.set("content-disposition", 'attachment; filename="commerce-os-shopling-stock-state-v0.5.5-hf7.zip"');
  headers.set("x-stock-hotfix", HOTFIX);
  headers.set("cache-control", "no-store");
  return new Response(baseResponse.body, {
    status: baseResponse.status,
    statusText: baseResponse.statusText,
    headers,
  });
}
