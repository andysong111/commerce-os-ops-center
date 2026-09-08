import { GET as getBaseDownload } from "../download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOTFIX = "HF5_A21_WHOLE_INFO_PRICE_ROW_COMPAT";
const MODE = "A6_READ_ONLY_BCODE_GOODSKEYS_THEN_API_STATUS_THEN_A21_WHOLE_INFO_OPTION_SEND_HF5";

export async function GET(request: Request) {
  const baseResponse = await getBaseDownload(request);
  const url = new URL(request.url);

  if (url.searchParams.get("verify") === "1") {
    const payload = await baseResponse.json() as Record<string, unknown>;
    return Response.json({
      ...payload,
      hotfix: HOTFIX,
      mode: MODE,
      a21ListScope: "WHOLE_INFO",
      a21NativeHeaderSelectRequired: false,
      a21SelectionCompatibility: "PRICE_EXTENSION_ROW_CHECKBOX_CLICK_CHECKED_INPUT_CHANGE",
      liveShoplingVerified: false,
    }, { headers: { "cache-control": "no-store" } });
  }

  const headers = new Headers(baseResponse.headers);
  headers.set("content-disposition", 'attachment; filename="commerce-os-shopling-stock-state-v0.5.5-hf5.zip"');
  headers.set("x-stock-hotfix", HOTFIX);
  headers.set("cache-control", "no-store");
  return new Response(baseResponse.body, {
    status: baseResponse.status,
    statusText: baseResponse.statusText,
    headers,
  });
}
