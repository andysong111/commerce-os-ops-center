import { temporaryOpsIdentity } from "@/lib/opsLoginBypass";
import { buildProductLaunchTrackerIndex } from "@/lib/productLaunchTrackerOptimized";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
} from "@/lib/productLaunchTrackerServer";
import {
  buildProductLaunchPurchaseMetadataMap,
  type ProductLaunchPurchaseMetadata,
} from "@/lib/productLaunchPurchaseMetadataCore";

export type { ProductLaunchPurchaseMetadata } from "@/lib/productLaunchPurchaseMetadataCore";
export { buildProductLaunchPurchaseMetadataMap as buildMetadataMap } from "@/lib/productLaunchPurchaseMetadataCore";

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
      byBarcode: buildProductLaunchPurchaseMetadataMap(index.summaries),
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
