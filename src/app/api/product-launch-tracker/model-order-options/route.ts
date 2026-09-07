import { NextRequest } from "next/server";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { resolveProductLaunchIdentity } from "@/lib/productLaunchTrackerServer";
import type { ProductPlanningSnapshot } from "@/lib/shopling/shoplingLiveAggregation";
import { normalizeTossCompatibleOptionRows } from "@/lib/tossCompatibleOption";

export const dynamic = "force-dynamic";

const MODEL_PATTERN = /^AAA\d{3,}$/;
const BARCODE_PATTERN = /^[A-Z]{3}\d+-\d+$/;
const CACHE_TTL_MS = 5 * 60 * 1000;

type PlanningSnapshot = Awaited<ReturnType<typeof loadProductPlanningSnapshot>>;

type PlanningCache = {
  expiresAt: number;
  snapshot: PlanningSnapshot;
};

let planningCache: PlanningCache | null = null;
let planningRequest: Promise<PlanningSnapshot> | null = null;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizeModelNumber(value: unknown) {
  const candidate = text(value).toUpperCase().replace(/\s+/g, "");
  const match = candidate.match(/^AAA0*(\d+)$/);
  if (!match) return MODEL_PATTERN.test(candidate) ? candidate : "";
  return `AAA${match[1].padStart(3, "0")}`;
}

function normalizeBarcode(value: unknown) {
  const candidate = text(value).toUpperCase().replace(/\s+/g, "");
  return BARCODE_PATTERN.test(candidate) ? candidate : "";
}

function nonNegativeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.ceil(parsed)) : 0;
}

async function planningSnapshot() {
  const now = Date.now();
  if (planningCache && planningCache.expiresAt > now) {
    return planningCache.snapshot;
  }
  if (!planningRequest) {
    planningRequest = loadProductPlanningSnapshot()
      .then((snapshot) => {
        planningCache = { expiresAt: Date.now() + CACHE_TTL_MS, snapshot };
        return snapshot;
      })
      .finally(() => {
        planningRequest = null;
      });
  }
  return planningRequest;
}

function optionsForModel(
  products: ProductPlanningSnapshot["products"],
  modelNumber: string,
) {
  const byBarcode = new Map<
    string,
    {
      id: string;
      optionName: string;
      saleOption: string;
      barcode: string;
      baseSalePriceKrw: number;
      unitCostKrw: number;
      sourceOrderItemId: null;
    }
  >();
  const productNames = new Set<string>();

  for (const product of products) {
    if (product.skuActive === false) continue;
    if (normalizeModelNumber(product.modelNo) !== modelNumber) continue;
    const barcode = normalizeBarcode(product.barcode);
    if (!barcode) continue;
    const saleOption = text(product.optionName) || "단품";
    const productName = text(product.productName);
    if (productName) productNames.add(productName);
    const unitCostKrw =
      nonNegativeInteger(product.protectedCostKrw) ||
      nonNegativeInteger(product.latestCostKrw);
    const current = byBarcode.get(barcode);
    if (!current) {
      byBarcode.set(barcode, {
        id: `model-${barcode}`,
        optionName: "",
        saleOption,
        barcode,
        baseSalePriceKrw: 0,
        unitCostKrw,
        sourceOrderItemId: null,
      });
      continue;
    }
    if ((!current.saleOption || current.saleOption === "단품") && saleOption) {
      current.saleOption = saleOption;
    }
    current.unitCostKrw = Math.max(current.unitCostKrw, unitCostKrw);
  }

  const options = [...byBarcode.values()].sort((left, right) =>
    left.barcode.localeCompare(right.barcode),
  );
  if (!options.length) return options;

  return normalizeTossCompatibleOptionRows(
    options,
    [...productNames, modelNumber].join(" "),
  ).rows;
}

function isTossOptionNormalizationError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return [
    "토스 호환 옵션",
    "서로 다른 옵션명",
    "동일한 옵션값",
    "단품 옵션",
  ].some((fragment) => error.message.includes(fragment));
}

export async function GET(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });

  const modelNumber = normalizeModelNumber(
    request.nextUrl.searchParams.get("modelNumber"),
  );
  if (!modelNumber) {
    return Response.json(
      {
        ok: false,
        code: "MODEL_NUMBER_REQUIRED",
        message: "정확한 AAA 모델번호가 필요합니다.",
      },
      { status: 400 },
    );
  }

  try {
    const snapshot = await planningSnapshot();
    const options = optionsForModel(snapshot.products, modelNumber);
    return Response.json(
      {
        ok: true,
        modelNumber,
        source: "product_master_planning_snapshot",
        optionNormalization: "toss_compatible_v1",
        generatedAt: snapshot.generatedAt,
        contentFingerprint: snapshot.contentFingerprint,
        optionCount: options.length,
        options,
        message: options.length
          ? `${modelNumber}의 실제 B-code ${options.length}개를 Product Master에서 확인하고 토스 호환 옵션명으로 정규화했습니다.`
          : `${modelNumber}에 연결된 활성 B-code를 Product Master에서 찾지 못했습니다.`,
      },
      { status: 200 },
    );
  } catch (error) {
    if (isTossOptionNormalizationError(error)) {
      return Response.json(
        {
          ok: false,
          code: "TOSS_OPTION_REVIEW_REQUIRED",
          message:
            error instanceof Error
              ? error.message
              : "토스 호환 옵션명을 자동 확정하지 못했습니다.",
        },
        { status: 422 },
      );
    }
    return Response.json(
      {
        ok: false,
        code: "MODEL_BCODE_AUTHORITY_UNAVAILABLE",
        message:
          error instanceof Error
            ? `모델별 B-code 기준정보를 불러오지 못했습니다: ${error.message}`
            : "모델별 B-code 기준정보를 불러오지 못했습니다.",
      },
      { status: 503 },
    );
  }
}
