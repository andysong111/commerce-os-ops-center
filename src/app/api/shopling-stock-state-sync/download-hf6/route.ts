import { GET as getBaseDownload } from "../download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOTFIX = "HF6_A21_PROVEN_PRICE_ROW_CHECKBOX_DIRECT";
const MODE = "A6_READ_ONLY_BCODE_GOODSKEYS_THEN_API_STATUS_THEN_A21_DIRECT_PRICE_ROW_CHECKBOX_OPTION_SEND_HF6";

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
      a21SelectionBridge: "MAIN_WORLD_HIDDEN_BRIDGE_INSIDE_RESULT_TABLE",
      a21SelectionVerification: "ALL_RESULT_ROWS_CHECKED_BEFORE_MODIFY_SEND",
      liveShoplingVerified: false,
    }, { headers: { "cache-control": "no-store" } });
  }

  const headers = new Headers(baseResponse.headers);
  headers.set("content-disposition", 'attachment; filename="commerce-os-shopling-stock-state-v0.5.5-hf6.zip"');
  headers.set("x-stock-hotfix", HOTFIX);
  headers.set("cache-control", "no-store");
  return new Response(baseResponse.body, {
    status: baseResponse.status,
    statusText: baseResponse.statusText,
    headers,
  });
}
