import { loadStocktakeInterventionPlan } from "@/lib/stage8StocktakeInterventionPlan";

const DEFAULT_PRODUCT_MASTER_URL = "https://commerce-os-product-master.vercel.app";
const FINGERPRINT = /^sha256:[a-f0-9]{64}$/;

type ProductMasterCanaryPreview = {
  skuId?: string;
  barcode?: string;
  modelNo?: string;
  productName?: string;
  optionName?: string;
  active?: boolean;
  inventoryQuantity?: number;
  inventoryVerification?: string;
  inventoryVerified?: boolean;
  inventoryBaselineKind?: string | null;
  inventoryBaselineQuantity?: number;
  inventoryLastMovementAt?: string | null;
  inventoryRequiresReview?: boolean;
  inventoryGuard?: string;
  canaryEligible?: boolean;
  writeEnabled?: boolean;
};

export type StocktakeCanaryPreflight = {
  generatedAt: string;
  state: "READY_FOR_PHYSICAL_COUNT" | "NO_CANDIDATE" | "BLOCKED";
  message: string;
  barcode: string | null;
  name: string | null;
  modelNo: string | null;
  requestedOperatorInput: "PHYSICAL_QUANTITY" | null;
  planFingerprint: string;
  inventoryGuard: string | null;
  productMasterSkuId: string | null;
  inventoryVerification: string | null;
  inventoryBaselineKind: string | null;
  inventoryQuantity: number | null;
  productMasterCanaryEligible: boolean;
  productMasterWriteEnabled: boolean;
  stocktakeWritesEnabled: false;
  purchaseWritesEnabled: false;
};

function connection() {
  const secret = process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim();
  if (!secret) throw new Error("PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED");
  const baseUrl = (
    process.env.PRODUCT_MASTER_BASE_URL?.trim() || DEFAULT_PRODUCT_MASTER_URL
  ).replace(/\/$/, "");
  if (!/^https:\/\//.test(baseUrl)) {
    throw new Error("PRODUCT_MASTER_BASE_URL_INVALID");
  }
  return { baseUrl, secret };
}

async function fetchPreview(barcode: string) {
  const { baseUrl, secret } = connection();
  const response = await fetch(
    `${baseUrl}/api/integrations/stocktake-canary?barcode=${encodeURIComponent(barcode)}`,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-commerce-os-integration-secret": secret,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    preview?: ProductMasterCanaryPreview;
    message?: string;
    error?: string;
  };
  if (!response.ok || payload.ok !== true || !payload.preview) {
    throw new Error(
      payload.message ||
        payload.error ||
        `PRODUCT_MASTER_STOCKTAKE_CANARY_PREVIEW_FAILED:${response.status}`,
    );
  }
  return payload.preview;
}

export async function loadStocktakeCanaryPreflight(): Promise<StocktakeCanaryPreflight> {
  const plan = await loadStocktakeInterventionPlan();
  const canary = plan.rows.find((row) => row.canary) ?? null;
  if (!canary || !plan.firstCanaryBarcode) {
    return {
      generatedAt: new Date().toISOString(),
      state: plan.state === "BLOCKED" ? "BLOCKED" : "NO_CANDIDATE",
      message: "현재 1건 STOCKTAKE canary로 요청할 안전 후보가 없습니다.",
      barcode: null,
      name: null,
      modelNo: null,
      requestedOperatorInput: null,
      planFingerprint: plan.planFingerprint,
      inventoryGuard: null,
      productMasterSkuId: null,
      inventoryVerification: null,
      inventoryBaselineKind: null,
      inventoryQuantity: null,
      productMasterCanaryEligible: false,
      productMasterWriteEnabled: false,
      stocktakeWritesEnabled: false,
      purchaseWritesEnabled: false,
    };
  }
  const preview = await fetchPreview(canary.barcode);
  const guard = String(preview.inventoryGuard ?? "").trim();
  const exactIdentity =
    String(preview.barcode ?? "").trim().toUpperCase() === canary.barcode &&
    preview.active === true;
  const safeInventory =
    preview.canaryEligible === true &&
    preview.inventoryVerified === false &&
    preview.inventoryVerification === "UNVERIFIED" &&
    preview.inventoryBaselineKind === "INITIAL_ZERO" &&
    preview.inventoryRequiresReview === false &&
    FINGERPRINT.test(guard);
  const ready =
    plan.state === "READY_FOR_OPERATOR_COUNT" &&
    exactIdentity &&
    safeInventory;
  return {
    generatedAt: new Date().toISOString(),
    state: ready ? "READY_FOR_PHYSICAL_COUNT" : "BLOCKED",
    message: ready
      ? preview.writeEnabled
        ? "선택형 재고보정 경로의 Product Master guard와 서명된 1건 write 경로를 확인했습니다. 발주사이클은 실사 없이 추정재고로 계속 진행하며, 이 입력은 오류 교정이 필요할 때만 사용합니다."
        : "선택형 재고보정 경로의 Product Master guard를 확인했습니다. 발주사이클은 실사 없이 추정재고로 계속 진행하며, 이 입력은 오류 교정이 필요할 때만 사용합니다."
      : "Stage 8 계획과 Product Master 현재 재고상태가 동시에 안전조건을 만족하지 않아 실물 수량을 요청하지 않습니다.",
    barcode: canary.barcode,
    name: canary.name,
    modelNo: canary.modelNo,
    requestedOperatorInput: ready ? "PHYSICAL_QUANTITY" : null,
    planFingerprint: plan.planFingerprint,
    inventoryGuard: guard || null,
    productMasterSkuId: String(preview.skuId ?? "").trim() || null,
    inventoryVerification: String(preview.inventoryVerification ?? "").trim() || null,
    inventoryBaselineKind: preview.inventoryBaselineKind ?? null,
    inventoryQuantity:
      typeof preview.inventoryQuantity === "number"
        ? preview.inventoryQuantity
        : null,
    productMasterCanaryEligible: preview.canaryEligible === true,
    productMasterWriteEnabled: preview.writeEnabled === true,
    stocktakeWritesEnabled: false,
    purchaseWritesEnabled: false,
  };
}
