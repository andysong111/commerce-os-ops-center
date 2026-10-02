import { readShoplingIdentitySources } from "./shopling-api-identity-source.mjs";
import { resolveShipmentManifestBCodes } from "./shopling-bcode-resolution.mjs";
import { createLabelObservationFromImage } from "./shopling-label-ocr.mjs";
import { buildShoplingPostPackingPlan } from "./shopling-post-packing-plan.mjs";
import { captureShoplingShipmentManifest } from "./shopling-shipment-manifest.mjs";
import { reconcileUnshippedLabels } from "./shopling-unshipped-reconciliation.mjs";

export async function createShoplingUnshippedReview(input, dependencies = {}) {
  if (!Array.isArray(input.imagePaths) || input.imagePaths.length === 0) {
    const error = new Error("At least one leftover label image is required.");
    error.code = "LABEL_IMAGES_REQUIRED";
    throw error;
  }

  const captureManifest = dependencies.captureManifest || captureShoplingShipmentManifest;
  const readIdentitySources = dependencies.readIdentitySources || readShoplingIdentitySources;
  const recognizeImage = dependencies.createObservation || createLabelObservationFromImage;
  const manifest = await captureManifest(input.localConfig, {
    status: input.status || "A04",
    selectedOnly: input.selectedOnly === true,
  });
  const sources = await readIdentitySources({
    config: input.apiConfig,
    startDate: manifest.filters?.startDate,
    endDate: manifest.filters?.endDate,
    shoplingOrderNos: manifest.orders.map((row) => row.shoplingOrderNo),
  });
  const resolvedManifest = resolveShipmentManifestBCodes({ manifest, ...sources });
  const observations = [];
  for (const imagePath of input.imagePaths) {
    observations.push(await recognizeImage(imagePath, {
      reason: input.reason || "UNSPECIFIED",
      expectedLabelCount: input.expectedLabelCount ?? 1,
      stockoutBCodes: input.stockoutBCodes || [],
    }));
  }
  const reconciliation = reconcileUnshippedLabels({
    manifestRows: resolvedManifest.orders,
    observations,
  });
  const actionPlan = buildShoplingPostPackingPlan(reconciliation);

  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    mode: "DRY_RUN",
    source: {
      capturedAt: resolvedManifest.capturedAt,
      orderCount: resolvedManifest.orderCount,
      selectedStatus: resolvedManifest.selectedStatus,
      filters: resolvedManifest.filters,
      privacy: resolvedManifest.privacy,
    },
    bCodeResolution: resolvedManifest.bCodeResolution,
    reconciliation,
    actionPlan,
    executionGate: {
      readyForOperatorReview: reconciliation.executionGate.readyForReview,
      externalWritesAllowed: false,
      invoiceDeletionEnabled: false,
      stockoutMutationEnabled: false,
    },
  };
}
