import { loadLegacySeoInventoryCatalog } from "@/lib/legacySeoInventoryCatalog";
import {
  matchFreightItemsToProductMaster,
  matchFreightItemsWithPurchaseDraftFallback,
  selectFreightPurchaseDraftLinesByOrderNumbers,
} from "@/lib/freightProductMasterMatcher";
import { loadChinaOrderLedger } from "@/lib/chinaOrderLedger";
import { loadFastPurchaseInternalDrafts } from "@/lib/fastPurchaseInternalDraft";
import { loadInternalChinaPurchaseDraft } from "@/lib/internalChinaPurchaseDraft";
import { resolveProductLaunchIdentity } from "@/lib/productLaunchTrackerServer";
import type { FreightApplicationItem } from "@/types/freightBarcodeRequest";

const MAX_ITEMS_PER_REQUEST = 500;
const MAX_AUTO_DRAFTS = 12;
const CATALOG_CACHE_MS = 5 * 60 * 1_000;

let catalogCache:
  | {
      expiresAt: number;
      products: Awaited<ReturnType<typeof loadLegacySeoInventoryCatalog>>;
    }
  | undefined;

type MatchRequestBody = {
  items?: unknown;
  draftId?: unknown;
};

const DRAFT_ID_PATTERN = /^fast-purchase-draft:[a-f0-9]{20}$/;

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
    (item.lookupText === undefined || typeof item.lookupText === "string") &&
    (item.orderNo === undefined || typeof item.orderNo === "string") &&
    (item.trackingNo === undefined || typeof item.trackingNo === "string")
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

async function loadOrderNumberMatchedDraftLines(items: FreightApplicationItem[]) {
  if (!items.some((item) => item.orderNo?.trim())) return null;

  const ledger = await loadChinaOrderLedger();
  const state = await loadFastPurchaseInternalDrafts({ ledger });
  if (state.error) return null;

  const loaded = await Promise.allSettled(
    state.drafts.slice(0, MAX_AUTO_DRAFTS).map(async (summary) => {
      const draft = await loadInternalChinaPurchaseDraft(summary.draftId, { ledger });
      return { draftId: summary.draftId, lines: draft.lines };
    }),
  );
  const selection = selectFreightPurchaseDraftLinesByOrderNumbers(
    items,
    loaded.flatMap((result) => result.status === "fulfilled" ? [result.value] : []),
  );
  return selection.lines.length > 0 ? selection : null;
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

  const draftId = typeof body.draftId === "string" ? body.draftId.trim() : "";
  if (body.draftId !== undefined && !DRAFT_ID_PATTERN.test(draftId)) {
    return Response.json(
      { ok: false, message: "연결된 발주초안 번호가 올바르지 않습니다." },
      { status: 400 },
    );
  }

  try {
    const [products, explicitDraft, automaticDraft] = await Promise.all([
      loadCachedCatalog(),
      draftId ? loadInternalChinaPurchaseDraft(draftId) : Promise.resolve(null),
      draftId ? Promise.resolve(null) : loadOrderNumberMatchedDraftLines(body.items),
    ]);
    const explicitSelection = explicitDraft
      ? selectFreightPurchaseDraftLinesByOrderNumbers(body.items, [
          { draftId, lines: explicitDraft.lines },
        ])
      : null;
    const draftLines = explicitDraft?.lines ?? automaticDraft?.lines ?? null;
    const result = draftLines
      ? matchFreightItemsWithPurchaseDraftFallback(body.items, draftLines, products)
      : matchFreightItemsToProductMaster(body.items, products);
    return Response.json({
      ...result,
      ...(explicitDraft
        ? {
            purchaseDraftResolution: {
              mode: "EXPLICIT" as const,
              draftIds: [draftId],
              requestedOrderCount: explicitSelection?.requestedOrderCount ?? 0,
              resolvedOrderCount: explicitSelection?.resolvedOrderCount ?? 0,
            },
          }
        : automaticDraft
          ? {
              purchaseDraftResolution: {
                mode: "ORDER_NUMBER_AUTO" as const,
                draftIds: automaticDraft.draftIds,
                requestedOrderCount: automaticDraft.requestedOrderCount,
                resolvedOrderCount: automaticDraft.resolvedOrderCount,
              },
            }
          : {}),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "UNKNOWN";
    const configurationError =
      detail === "PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED" ||
      detail === "PRODUCT_MASTER_BASE_URL_INVALID";
    const draftError = Boolean(draftId) && detail.startsWith("INTERNAL_CHINA_");
    return Response.json(
      {
        ok: false,
        message: draftError
          ? "선택한 발주초안을 불러오지 못했습니다. 발주차시 화면에서 다시 들어와주세요."
          : configurationError
            ? "커머스OS 상품마스터 연결 설정을 확인해주세요."
            : "커머스OS 상품마스터를 불러오지 못했습니다.",
      },
      { status: 503 },
    );
  }
}
