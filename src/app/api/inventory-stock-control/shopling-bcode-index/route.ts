import { refreshShoplingBcodeIndex } from "@/lib/shopling/shoplingBcodeIndex";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json(
      { ok: false, code: "SHOPLING_BCODE_INDEX_UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const result = await refreshShoplingBcodeIndex({});
    return Response.json(
      {
        ok: true,
        result,
        message: `Shopling API 읽기 전용 전체조회로 B코드 ${result.indexedBcodeCount}개 인덱스를 갱신했습니다.`,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "SHOPLING_BCODE_INDEX_REFRESH_FAILED",
        message: error instanceof Error ? error.message : String(error ?? "인덱스 갱신 실패"),
      },
      { status: 409, headers: { "cache-control": "no-store" } },
    );
  }
}
