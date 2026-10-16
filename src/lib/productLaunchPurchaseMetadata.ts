import { temporaryOpsIdentity } from "@/lib/opsLoginBypass";
import { buildProductLaunchTrackerIndex } from "@/lib/productLaunchTrackerOptimized";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
} from "@/lib/productLaunchTrackerServer";

const BARCODE_PATTERN = /^[A-Z]{3}\d+-\d+$/;

export type ProductLaunchPurchaseMetadata = {
  barcode: string;
  modelNumber: string;
  productName: string;
  supplierLink: string;
  saleOption: string;
  chinaOption: string;
  purchaseQuantityMultiplier: number;
  purchaseComponents: Array<{ chinaOption: string; quantityMultiplier: number }>;
  purchaseOptionSelection: "EXACT" | "ANY_AVAILABLE";
  conflict: boolean;
};

type Candidate = Omit<ProductLaunchPurchaseMetadata, "conflict">;

export async function loadProductLaunchPurchaseMetadataByBarcode() {
  try {
    const configResult = getProductLaunchAdminConfig();
    if (!configResult.ok) {
      return {
        byBarcode: new Map<string, ProductLaunchPurchaseMetadata>(),
        error: configResult.body.code,
      };
    }
    const identity = temporaryOpsIdentity();
    const stored = await readProductLaunchState(configResult.value, identity.userId);
    const index = buildProductLaunchTrackerIndex(
      stored?.state_payload && typeof stored.state_payload === "object"
        ? stored.state_payload
        : {},
    );
    return {
      byBarcode: buildMetadataMap(index.summaries),
      error: null as string | null,
    };
  } catch (error) {
    return {
      byBarcode: new Map<string, ProductLaunchPurchaseMetadata>(),
      error:
        error instanceof Error
          ? error.message
          : "PRODUCT_LAUNCH_PURCHASE_METADATA_UNAVAILABLE",
    };
  }
}

export function buildMetadataMap(
  summaries: Array<{
    barcode?: unknown;
    modelNumber?: unknown;
    productName?: unknown;
    chinaProductLinks?: unknown;
    orderOptions?: unknown;
  }>,
) {
  const candidates = new Map<string, Candidate[]>();
  for (const summary of summaries) {
    const summaryLinks = Array.isArray(summary.chinaProductLinks)
      ? summary.chinaProductLinks.map(normalizeSupplierLink).filter(Boolean)
      : [];
    // Purchase policy: all B-codes under the same model use the product-level
    // fixed #1 China link. Per-B-code supplier links are intentionally ignored.
    const fixedFirstSupplierLink = summaryLinks[0] ?? "";
    const modelNumber = text(summary.modelNumber);
    const productName = text(summary.productName);
    const options = Array.isArray(summary.orderOptions)
      ? summary.orderOptions.filter(isRecord)
      : [];
    const optionBarcodes = new Set<string>();

    for (const option of options) {
      const barcode = normalizeBarcode(option.barcode);
      if (!BARCODE_PATTERN.test(barcode)) continue;
      optionBarcodes.add(barcode);
      addCandidate(candidates, {
        barcode,
        modelNumber,
        productName,
        supplierLink: fixedFirstSupplierLink,
        saleOption: text(option.saleOption),
        chinaOption: text(option.chinaOption),
        ...purchasePolicy(option),
      });
    }

    const mainBarcode = normalizeBarcode(summary.barcode);
    if (BARCODE_PATTERN.test(mainBarcode) && !optionBarcodes.has(mainBarcode)) {
      const only = options.length === 1 ? options[0] : null;
      addCandidate(candidates, {
        barcode: mainBarcode,
        modelNumber,
        productName,
        supplierLink: fixedFirstSupplierLink,
        saleOption: text(only?.saleOption),
        chinaOption: text(only?.chinaOption),
        ...purchasePolicy(only),
      });
    }
  }

  return new Map(
    [...candidates.entries()].map(([barcode, rows]) => {
      const modelNumbers = uniqueNonEmpty(rows.map((row) => row.modelNumber));
      const productNames = uniqueNonEmpty(rows.map((row) => row.productName));
      const supplierLinks = uniqueNonEmpty(rows.map((row) => row.supplierLink));
      const saleOptions = uniqueNonEmpty(rows.map((row) => row.saleOption));
      const chinaOptions = uniqueNonEmpty(rows.map((row) => row.chinaOption));
      const purchaseQuantityMultipliers = uniqueNumbers(rows.map((row) => row.purchaseQuantityMultiplier));
      const purchaseComponents = uniqueJson(rows.map((row) => row.purchaseComponents));
      const purchaseOptionSelections = uniqueNonEmpty(rows.map((row) => row.purchaseOptionSelection));
      const conflict =
        supplierLinks.length > 1 ||
        saleOptions.length > 1 ||
        chinaOptions.length > 1 ||
        purchaseQuantityMultipliers.length > 1 ||
        purchaseComponents.length > 1 ||
        purchaseOptionSelections.length > 1;
      return [
        barcode,
        {
          barcode,
          modelNumber: modelNumbers.length === 1 ? modelNumbers[0] : "",
          productName: productNames.length === 1 ? productNames[0] : "",
          supplierLink: supplierLinks.length === 1 ? supplierLinks[0] : "",
          saleOption: saleOptions.length === 1 ? saleOptions[0] : "",
          chinaOption: chinaOptions.length === 1 ? chinaOptions[0] : "",
          purchaseQuantityMultiplier: purchaseQuantityMultipliers.length === 1 ? purchaseQuantityMultipliers[0] : 1,
          purchaseComponents: purchaseComponents.length === 1 ? JSON.parse(purchaseComponents[0]) : [],
          purchaseOptionSelection: purchaseOptionSelections.length === 1 && purchaseOptionSelections[0] === "ANY_AVAILABLE" ? "ANY_AVAILABLE" : "EXACT",
          conflict,
        },
      ] as const;
    }),
  );
}

function purchasePolicy(option: unknown) {
  const policy = isRecord(option) && isRecord(option.purchasePolicy) ? option.purchasePolicy : {};
  const quantityMultiplier = positiveInteger(policy.quantityMultiplier, 1);
  const purchaseComponents = Array.isArray(policy.components)
    ? policy.components.filter(isRecord).map((row) => ({
        chinaOption: text(row.chinaOption),
        quantityMultiplier: positiveInteger(row.quantityMultiplier, 1),
      })).filter((row) => row.chinaOption)
    : [];
  return {
    purchaseQuantityMultiplier: quantityMultiplier,
    purchaseComponents,
    purchaseOptionSelection: text(policy.optionSelection) === "ANY_AVAILABLE" ? "ANY_AVAILABLE" as const : "EXACT" as const,
  };
}

function addCandidate(map: Map<string, Candidate[]>, candidate: Candidate) {
  map.set(candidate.barcode, [...(map.get(candidate.barcode) ?? []), candidate]);
}

function normalizeSupplierLink(value: unknown) {
  const candidate = text(value);
  if (!candidate || candidate.length > 4000) return "";
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizeBarcode(value: unknown) {
  return text(value).normalize("NFKC").toUpperCase().replace(/\s+/g, "");
}

function uniqueNonEmpty(values: string[]) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function uniqueNumbers(values: number[]) { return [...new Set(values)]; }
function uniqueJson(values: unknown[]) { return [...new Set(values.map((value) => JSON.stringify(value)))]; }
function positiveInteger(value: unknown, fallback: number) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown) {
  return String(value ?? "").trim();
}
