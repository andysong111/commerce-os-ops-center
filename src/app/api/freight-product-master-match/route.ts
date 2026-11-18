import { loadLegacySeoInventoryCatalog } from "@/lib/legacySeoInventoryCatalog";
import { matchFreightItemsToProductMaster } from "@/lib/freightProductMasterMatcher";
import { resolveProductLaunchIdentity } from "@/lib/productLaunchTrackerServer";
import type { FreightApplicationItem } from "@/types/freightBarcodeRequest";

const MAX_ITEMS_PER_REQUEST = 500;
const CATALOG_CACHE_MS = 5 * 60 * 1_000;

let catalogCache:
  | {
      expiresAt: number;
      products: Awaited<ReturnType<typeof loadLegacySeoInventoryCatalog>>;
    }
  | undefined;

type MatchRequestBody = {
  items?: unknown;
};

function isMatchItem(value: unknown): value is FreightApplicationItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<FreightApplicationItem>;
  return (
    typeof item.id === "string" &&
    item.id.length > 0 &&
    typeof item.rowNo === "number" &&
    Number.isFinite(item.rowNo) &&
    typeof item.itemName === "string" &&
    typeof item.optionText === "string" &&
    (item.applicationNo === undefined || typeof item.applicationNo === "string") &&
    (item.detailUrl === undefined || typeof item.detailUrl === "string") &&
    (item.lookupText === undefined || typeof item.lookupText === "string")
  );
}

async function loadCachedCatalog() {
  if (catalogCache && catalogCache.expiresAt > Date.now()) {
    return catalogCache.products;
  }
  const products = await loadLegacySeoInventoryCatalog();
  catalogCache = { products, expiresAt: Date.now() + CATALOG_CACHE_MS };
  return products;
}

export async function POST(request: Request) {
  const auth = await resolveProductLaunchIdentity(request);
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  let body: MatchRequestBody;
  try {
    body = (await request.json()) as MatchRequestBody;
  } catch {
    return Response.json(
      { ok: false, message: "요청 본문이 올바른 JSON이 아닙니다." },
      { status: 400 },
    );
  }

  if (
    !Array.isArray(body.items) ||
    body.items.length === 0 ||
    body.items.length > MAX_ITEMS_PER_REQUEST ||
    !body.items.every(isMatchItem)
  ) {
    return Response.json(
      {
        ok: false,
        message: `상품마스터 매칭 품목은 1~${MAX_ITEMS_PER_REQUEST}개로 보내주세요.`,
      },
      { status: 400 },
    );
  }

  try {
    const products = await loadCachedCatalog();
    return Response.json(matchFreightItemsToProductMaster(body.items, products));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "UNKNOWN";
    const configurationError =
      detail === "PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED" ||
      detail === "PRODUCT_MASTER_BASE_URL_INVALID";
    return Response.json(
      {
        ok: false,
        message: configurationError
          ? "커머스OS 상품마스터 연결 설정을 확인해주세요."
          : "커머스OS 상품마스터를 불러오지 못했습니다.",
      },
      { status: 503 },
    );
  }
}
